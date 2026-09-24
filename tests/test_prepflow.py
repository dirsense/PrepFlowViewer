import copy
import io
import json
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import prepflow

SAMPLE = prepflow.ROOT / "samples" / "Superstore.tflx"


def raw_flow(nodes):
    return io.BytesIO(json.dumps({"nodes": nodes}, ensure_ascii=False).encode("utf-8"))


class SampleTests(unittest.TestCase):
    def test_file_size_is_original_package_bytes(self):
        self.assertEqual(prepflow.analyze(SAMPLE)["fileSizeBytes"], SAMPLE.stat().st_size)
        stream = io.BytesIO(SAMPLE.read_bytes())
        self.assertEqual(prepflow.analyze(stream)["fileSizeBytes"], SAMPLE.stat().st_size)

    def test_plain_flow_size_and_connection_ids(self):
        data = json.dumps({"nodes": {"input": {"id": "input", "name": "入力", "baseType": "input", "nodeType": ".v1.LoadSql", "connectionId": "server", "fields": [], "nextNodes": []}}, "connections": {"server": {"connectionAttributes": {"class": "sqlproxy", "projectname": "営業", "datasourcename": "売上"}}}}, ensure_ascii=False).encode('utf-8')
        model = prepflow.analyze(io.BytesIO(data))
        self.assertEqual(model['fileSizeBytes'], len(data))
        self.assertEqual(model['connections'][0]['id'], 'server')
        self.assertEqual(model['nodes'][0]['connection']['id'], 'server')
        self.assertEqual(model['nodes'][0]['connection']['connectionAttributes']['projectname'], '営業')

    @classmethod
    def setUpClass(cls):
        cls.model = prepflow.analyze(SAMPLE)
        cls.nodes = {n["name"]: n for n in cls.model["nodes"]}

    def test_reads_only_definition_members(self):
        original = zipfile.ZipFile.read
        reads = []
        def record(z, name, *args, **kwargs):
            reads.append(name.filename if isinstance(name, zipfile.ZipInfo) else name)
            return original(z, name, *args, **kwargs)
        with patch.object(zipfile.ZipFile, "read", record):
            prepflow.analyze(SAMPLE)
        self.assertEqual(set(reads), {"flow", "displaySettings", "maestroMetadata"})

    def test_complete_graph_and_saved_coordinates(self):
        self.assertEqual(self.model["stats"]["steps"], 19)
        self.assertEqual(len(self.model["edges"]), 18)
        self.assertEqual(self.model["stats"]["savedPositions"], 19)
        self.assertEqual(self.nodes["オーダー + 返品"]["position"], {"x": 4, "y": 2})
        self.assertEqual(self.nodes["ノルマ"]["color"], "#f6a035")

    def test_action_order_follows_graph_not_json_order(self):
        ops = self.nodes["メモ/承認者のクリーニング"]["actions"]
        self.assertEqual([a["type"] for a in ops], ["AddColumn", "AddColumn", "RenameColumn", "RenameColumn", "RemoveColumns", "Remap"])
        fields = {f["name"]: f for f in self.nodes["メモ/承認者のクリーニング"]["fields"]}
        self.assertIn("返品メモ", fields)
        self.assertIn("承認者", fields)
        self.assertNotIn("メモ", fields)

    def test_date_type_calculation_is_preserved(self):
        n = self.nodes["日付の修正"]
        self.assertEqual(len(n["calculations"]), 6)
        self.assertEqual(sum("DATEPARSE" in c["expression"] for c in n["calculations"]), 2)
        self.assertEqual(self.model["stats"]["calculations"], 16)
        self.assertEqual({f["name"]:f["type"] for f in n["fields"]}["オーダー日"], "date")

    def test_namespace_specific_join_actions(self):
        n = self.nodes["オーダー + 返品"]
        calcs = {c["field"]: c for c in n["calculations"]}
        self.assertEqual(calcs["返品？"]["namespace"], "Left")
        self.assertEqual(calcs["出荷までの日数"]["namespace"], "Right")
        names = {f["name"] for f in n["fields"]}
        self.assertIn("販売の年", names)
        self.assertNotIn("Table Names", names)
        self.assertNotIn("File Paths", names)
        self.assertFalse(n["schemaUncertain"])

    def test_pivot_and_aggregate_schemas(self):
        pivot = {f["name"]:f["type"] for f in self.nodes["ノルマのピボット"]["fields"]}
        self.assertEqual(pivot, {"販売地域":"string", "年":"integer", "ノルマ":"integer"})
        agg = {f["name"]:f for f in self.nodes["ロールアップ売上"]["fields"]}
        self.assertEqual(set(agg), {"販売の年", "販売地域", "割引率", "利益", "数量", "売上"})
        self.assertEqual(agg["売上"]["expression"], "SUM([売上])")

    def test_branch_specific_expressions_not_falsely_merged(self):
        fields = {f["name"]: f for f in self.nodes["すべてのオーダー"]["fields"]}
        self.assertIsNone(fields["販売地域"]["expression"])
        self.assertEqual({x["expression"] for x in fields["販売地域"]["expressionVariants"]}, {'"USCA"', '"APAC"', '"LATAM"', '"EMEA"'})

    def test_cleanup_preserves_right_product_id(self):
        n = self.nodes["クリーニング 2"]
        names = {f["name"] for f in n["fields"]}
        self.assertEqual(len(names), 26)
        self.assertIn("製品 ID", names)
        self.assertNotIn("製品 ID-1", names)
        self.assertNotIn("オーダー ID-1", names)

    def test_input_inventory_keeps_deleted_fields_and_types(self):
        for name, total, used in [("返品", 8, 4), ("注文 (EMEA)", 40, 20)]:
            with self.subTest(step=name):
                n = self.nodes[name]
                inventory = n["fieldInventory"]
                self.assertEqual(len(inventory), total)
                self.assertEqual(sum(not f["deleted"] for f in inventory), used)
                self.assertEqual({f["name"] for f in inventory if not f["deleted"]}, {f["name"] for f in n["fields"]})
                for f in inventory:
                    if f["deleted"]:
                        self.assertEqual(f["changes"][-1]["type"], "RemoveColumns")
                        self.assertIn(f["changes"][-1]["actionId"], {a["id"] for a in n["actions"]})

    def test_renames_are_not_deletions_and_changes_stay_local(self):
        n = self.nodes["メモ/承認者のクリーニング"]
        removed = [f["name"] for f in n["fieldInventory"] if f["deleted"]]
        self.assertEqual(removed, ["メモ"])
        renamed = next(f for f in n["fieldInventory"] if f["name"] == "返品メモ")
        self.assertEqual([c["type"] for c in renamed["changes"]], ["AddColumn", "RenameColumn"])
        self.assertFalse(renamed["deleted"])
        inherited = next(f for f in self.nodes["オーダー + 返品"]["fields"] if f["name"] == "返品メモ")
        self.assertEqual(inherited["changes"], [])

    def test_all_sample_files_parse(self):
        for file in (prepflow.ROOT / "samples").glob("*.tflx"):
            with self.subTest(file=file.name):
                m = prepflow.analyze(file)
                self.assertGreater(len(m["nodes"]), 0)
                ids = {n["id"] for n in m["nodes"]}
                self.assertTrue(all(e["source"] in ids and e["target"] in ids for e in m["edges"]))

    def test_html_payload_cannot_close_script(self):
        model = copy.deepcopy(self.model)
        model["name"] = '</script><script>alert("x")</script>'
        html = prepflow.render_html(model)
        payload = html.split('<script id="flow-data" type="application/json">',1)[1].split('</script>',1)[0]
        self.assertNotIn("<", payload)
        self.assertEqual(json.loads(payload)["name"], model["name"])
        self.assertNotIn('src="http', html)
        self.assertNotIn('href="http', html)


class DefensiveTests(unittest.TestCase):
    def test_plain_flow_and_missing_display(self):
        m = prepflow.analyze(raw_flow({"i":{"id":"i","name":"Input","baseType":"input","nodeType":".v1.LoadCsv","fields":[{"name":"x","type":"integer"}]}}))
        self.assertEqual(m["nodes"][0]["fields"][0]["name"], "x")
        self.assertFalse(m["nodes"][0]["savedPosition"])
        self.assertTrue(m["warnings"])

    def test_unknown_step_is_marked_uncertain(self):
        m = prepflow.analyze(raw_flow({"x":{"id":"x","name":"future","nodeType":".v9.FutureTransform","baseType":"transform"}}))
        self.assertTrue(m["nodes"][0]["warnings"])
        self.assertEqual(m["nodes"][0]["raw"]["nodeType"], ".v9.FutureTransform")

    def test_cycle_does_not_hang(self):
        m = prepflow.analyze(raw_flow({"a":{"id":"a","nextNodes":[{"nextNodeId":"b"}]},"b":{"id":"b","nextNodes":[{"nextNodeId":"a"}]}}))
        self.assertEqual(len(m["nodes"]), 2)
        self.assertTrue(all(n["warnings"] for n in m["nodes"]))

    def test_broken_file_is_rejected(self):
        for data in (b'garbage', b'{}', b'{"nodes":[]}'):
            with self.subTest(data=data), self.assertRaises(ValueError):
                prepflow.analyze(io.BytesIO(data))

    def test_missing_flow_archive_is_rejected(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive,"w") as z:
            z.writestr("Data/anything.csv","x\n1")
        archive.seek(0)
        with self.assertRaises(ValueError):
            prepflow.analyze(archive)

    def test_typed_expression_inference_is_conservative(self):
        for e,t in [('"USCA"','string'), ("YEAR([Date])",'integer'), ('IF [X] THEN [Y] ELSE [Z] END','unknown')]:
            self.assertEqual(prepflow.infer_type(e,{}),t)


if __name__ == "__main__":
    unittest.main()
