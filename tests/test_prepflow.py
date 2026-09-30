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
        data = json.dumps({"nodes": {"input": {"id": "input", "name": "Input", "baseType": "input", "nodeType": ".v1.LoadSql", "connectionId": "server", "fields": [], "nextNodes": []}}, "connections": {"server": {"connectionAttributes": {"class": "sqlproxy", "projectname": "Sales", "datasourcename": "Sales"}}}}, ensure_ascii=False).encode('utf-8')
        model = prepflow.analyze(io.BytesIO(data))
        self.assertEqual(model['fileSizeBytes'], len(data))
        self.assertEqual(model['connections'][0]['id'], 'server')
        self.assertEqual(model['nodes'][0]['connection']['id'], 'server')
        self.assertEqual(model['nodes'][0]['connection']['connectionAttributes']['projectname'], 'Sales')

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
        self.assertEqual(self.nodes["Orders + Returns"]["position"], {"x": 3, "y": 3})
        self.assertEqual(self.nodes["Quota"]["color"], "#F6A035")

    def test_action_order_follows_graph_not_json_order(self):
        ops = self.nodes["Clean Notes/Approver"]["actions"]
        self.assertEqual([a["type"] for a in ops], ["AddColumn", "AddColumn", "RenameColumn", "RenameColumn", "RemoveColumn", "Remap"])
        fields = {f["name"]: f for f in self.nodes["Clean Notes/Approver"]["fields"]}
        self.assertIn("Return Notes", fields)
        self.assertIn("Approver", fields)
        self.assertNotIn("Notes", fields)

    def test_date_type_calculation_is_preserved(self):
        n = self.nodes["Fix Dates"]
        self.assertEqual(len(n["calculations"]), 5)
        self.assertEqual(sum("DATEPARSE" in c["expression"] for c in n["calculations"]), 2)
        self.assertEqual(self.model["stats"]["calculations"], 12)
        self.assertEqual({f["name"]:f["type"] for f in n["fields"]}["Order Date"], "date")

    def test_namespace_specific_join_actions(self):
        n = self.nodes["Orders + Returns"]
        calcs = {c["field"]: c for c in n["calculations"]}
        self.assertEqual(calcs["Returned?"]["namespace"], "Left")
        self.assertEqual(calcs["Days to Ship"]["namespace"], "Right")
        names = {f["name"] for f in n["fields"]}
        self.assertIn("Year of Sale", names)
        self.assertNotIn("Table Names", names)
        self.assertNotIn("File Paths", names)
        self.assertFalse(n["schemaUncertain"])

    def test_pivot_and_aggregate_schemas(self):
        pivot = {f["name"]:f["type"] for f in self.nodes["Pivot Quotas"]["fields"]}
        self.assertEqual(pivot, {"Region":"string", "2014":"integer", "Year":"integer", "Quota":"unknown"})
        agg = {f["name"]:f for f in self.nodes["Roll Up Sales"]["fields"]}
        self.assertEqual(set(agg), {"Year of Sale", "Region", "Discount", "Profit", "Quantity", "Sales"})
        self.assertEqual(agg["Sales"]["expression"], "SUM([Sales])")

    def test_branch_specific_expressions_not_falsely_merged(self):
        fields = {f["name"]: f for f in self.nodes["All Orders"]["fields"]}
        self.assertIsNone(fields["Region"]["expression"])
        self.assertEqual({x["expression"] for x in fields["Region"]["expressionVariants"]}, {'"Central"', None})

    def test_cleanup_preserves_right_product_id(self):
        n = self.nodes["Clean 2"]
        names = {f["name"] for f in n["fields"]}
        self.assertEqual(len(names), 27)
        self.assertIn("Product ID", names)
        self.assertNotIn("Product ID-1", names)
        self.assertNotIn("Order ID-1", names)

    def test_input_inventory_keeps_deleted_fields_and_types(self):
        for name, total, used in [("Returns (all)", 9, 4), ("Orders (West)", 41, 21)]:
            with self.subTest(step=name):
                n = self.nodes[name]
                inventory = n["fieldInventory"]
                self.assertEqual(len(inventory), total)
                self.assertEqual(sum(not f["deleted"] for f in inventory), used)
                self.assertEqual({f["name"] for f in inventory if not f["deleted"]}, {f["name"] for f in n["fields"]})
                for f in inventory:
                    if f["deleted"]:
                        self.assertIn(f["changes"][-1]["type"], ("RemoveColumn", "RemoveColumns"))
                        self.assertIn(f["changes"][-1]["actionId"], {a["id"] for a in n["actions"]})

    def test_renames_are_not_deletions_and_changes_stay_local(self):
        n = self.nodes["Clean Notes/Approver"]
        removed = [f["name"] for f in n["fieldInventory"] if f["deleted"]]
        self.assertEqual(removed, ["Notes"])
        renamed = next(f for f in n["fieldInventory"] if f["name"] == "Return Notes")
        self.assertEqual([c["type"] for c in renamed["changes"]], ["AddColumn", "RenameColumn"])
        self.assertFalse(renamed["deleted"])
        inherited = next(f for f in self.nodes["Orders + Returns"]["fields"] if f["name"] == "Return Notes")
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
