"""Read Tableau Prep definitions without opening any data connection.

Python 3.10+, standard library only. The generated HTML is self-contained.
"""
from __future__ import annotations

import argparse
import copy
import io
import json
import re
import time
import zipfile
from collections import Counter, deque
from pathlib import Path
from recent_flows import RecentFlows
from formula_types import infer_type

ROOT = Path(__file__).resolve().parent
MAX_METADATA = 64 * 1024 * 1024
TYPE_LABELS = {
    "input": "入力", "clean": "クリーニング", "join": "結合", "union": "ユニオン",
    "aggregate": "集計", "pivot": "ピボット", "output": "出力", "other": "その他",
}
ACTION_LABELS = {
    "AddColumn": "計算フィールド", "QuickCalcColumn": "計算フィールド", "QuickDateNameCalcColumn": "日付を変換", "DuplicateColumn": "フィールドを複製",
    "RemoveColumns": "フィールドの削除", "RenameColumn": "フィールド名の変更",
    "ChangeColumnType": "タイプを変更", "RangeFilter": "フィルター", "ValueFilter": "フィルター",
    "Filter": "フィルター", "FilterOperation": "フィルター", "MultiRowCalc": "計算フィールド", "Remap": "値のグループ化・置換", "MergeColumns": "フィールドをマージ",
    "SimpleJoin": "結合", "SimpleUnion": "ユニオン", "Aggregate": "集計",
    "Unpivot": "列から行へのピボット", "UnpivotExtended": "列から行へのピボット",
    "Pivot": "行から列へのピボット",
}
QUICK_CALC_LABELS = {
    "Lowercase": "小文字にする", "Uppercase": "大文字にする", "Titlecase": "タイトルケースにする",
    "RemoveAllSpaces": "すべてのスペースを削除", "RemoveExtraSpaces": "余分なスペースを削除",
    "RemovePunctuations": "句読点を削除", "TrimSpaces": "スペースのトリミング",
    "RemoveLetters": "文字を削除", "RemoveNumbers": "数値を削除",
}


def short_type(node):
    return node.get("nodeType", "Unknown").split(".")[-1]


def action_label(node):
    if short_type(node) == "QuickCalcColumn":
        if node.get("calcExpressionType") in QUICK_CALC_LABELS:
            return QUICK_CALC_LABELS[node["calcExpressionType"]]
    if short_type(node) == "MultiRowCalc":
        calc_type = (node.get("specificRowCalc") or {}).get("calcType")
        if calc_type == "rankCalc":
            return "ランク"
        if calc_type == "fixedLodCalc":
            return "LOD計算"
    return ACTION_LABELS.get(short_type(node), short_type(node))


def kind_of(node):
    t = short_type(node)
    if node.get("baseType") == "input" or t.startswith("Load"):
        return "input"
    if node.get("baseType") == "output" or t.startswith("Write"):
        return "output"
    for token, kind in [("Join", "join"), ("Union", "union"), ("Aggregate", "aggregate"),
                        ("pivot", "pivot"), ("Pivot", "pivot")]:
        if token in t:
            return kind
    return "clean" if t == "Container" else "other"


def topo_order(nodes):
    """Stable Kahn ordering; never mistake JSON insertion order for action order."""
    degrees = {k: 0 for k in nodes}
    for n in nodes.values():
        for e in n.get("nextNodes", []):
            if e.get("nextNodeId") in degrees:
                degrees[e["nextNodeId"]] += 1
    queue = deque(k for k, d in degrees.items() if d == 0)
    ordered = []
    while queue:
        k = queue.popleft()
        ordered.append(k)
        for e in nodes[k].get("nextNodes", []):
            target = e.get("nextNodeId")
            if target in degrees:
                degrees[target] -= 1
                if degrees[target] == 0:
                    queue.append(target)
    seen = set(ordered)
    return ordered, [k for k in nodes if k not in seen]


def read_package(source):
    """Only decompress the three definition members, never Data/, images or extracts."""
    if isinstance(source, (str, Path)):
        source = Path(source)
        name = source.name
        is_zip = zipfile.is_zipfile(source)
    else:
        name = "Uploaded.tflx"
        is_zip = zipfile.is_zipfile(source)
        source.seek(0)
    entries = []
    if is_zip:
        with zipfile.ZipFile(source) as z:
            names = z.namelist()
            def read_member(name, required=False):
                candidates = [x for x in names if x == name or x.rsplit("/", 1)[-1] == name]
                if not candidates:
                    if required:
                        raise ValueError(f"必要な定義ファイル {name} がありません。")
                    return {}
                info = z.getinfo(candidates[0])
                if info.file_size > MAX_METADATA:
                    raise ValueError(f"{name} の定義サイズが上限64MBを超えています。")
                return json.loads(z.read(info).decode("utf-8-sig"))
            metadata = read_member("maestroMetadata")
            flow = read_member(metadata.get("flowEntryName", "flow"), True)
            display = read_member(metadata.get("displaySettingsEntryName", "displaySettings"))
            entries = [{"name": x.filename, "bytes": x.file_size} for x in z.infolist() if not x.is_dir()]
    else:
        if isinstance(source, Path):
            if source.stat().st_size > MAX_METADATA:
                raise ValueError("フロー定義のサイズが上限64MBを超えています。")
            data = source.read_bytes()
        else:
            data = source.read(MAX_METADATA + 1)
        if len(data) > MAX_METADATA:
            raise ValueError("フロー定義が大きすぎます。")
        flow = json.loads(data.decode("utf-8-sig"))
        display, metadata = {}, {}
    if not isinstance(flow, dict) or not isinstance(flow.get("nodes"), dict):
        raise ValueError("Tableau Prepの nodes 定義が見つかりません。")
    if not all(isinstance(n, dict) for n in flow["nodes"].values()):
        raise ValueError("ステップ定義が正しくありません。")
    return name, flow, display, metadata, entries


def field_ref(expression):
    # Tableau brackets can escape a closing bracket as ]].
    return list(dict.fromkeys(x.replace("]]", "]") for x in re.findall(r"\[((?:[^\]]|\]\])+)\]", expression or "")))


def expression_key(node):
    return "filterExpression" if short_type(node) == "FilterOperation" else "expression"


def expressions(node):
    result = []
    key = expression_key(node)
    if isinstance(node.get(key), str):
        result.append({"field": node.get("columnName", "条件式"), "expression": node[key]})
        if short_type(node) == "FilterOperation":
            result[-1]["references"] = field_ref(node[key])
    if short_type(node) == "ChangeColumnType":
        for name, info in node.get("fields", {}).items():
            if info.get("calc"):
                result.append({"field": name, "expression": info["calc"]})
    return result


def get_actions(node, warnings):
    result = []
    def add(n, phase, namespace="Default"):
        if not isinstance(n, dict):
            warnings.append("解釈できない加工定義があります。元の定義を確認してください。")
            return
        if "loomContainer" in n:
            for child in get_actions(n, warnings):
                result.append({**child, "phase": phase + " / " + child["phase"], "namespace": namespace})
            return
        exprs = expressions(n)
        result.append({"id": n.get("id", ""), "type": short_type(n),
                       "label": action_label(n),
                       "name": n.get("name", ""), "phase": phase, "namespace": namespace,
                       "expressions": exprs, "raw": n})
    for n in node.get("actions", []):
        add(n, "入力の加工")
    for n in node.get("filters") or []:
        add(n, "入力のフィルター")
    if "loomContainer" in node:
        inner = node["loomContainer"].get("nodes", {})
        order, unresolved = topo_order(inner)
        if unresolved:
            warnings.append("内部の加工順序を確定できません。循環している定義は末尾に表示します。")
        if any(len(n.get("nextNodes", [])) > 1 for n in inner.values()):
            warnings.append("内部に分岐があります。フィールド復元は参考情報です。元の定義で分岐を確認してください。")
        for k in order + unresolved:
            add(inner[k], "クリーニング")
    for n in node.get("beforeActionAnnotations", []):
        add(n.get("annotationNode", {}), "処理前", n.get("namespace", "Default"))
    if node.get("actionNode"):
        add(node["actionNode"], "主処理")
    for n in node.get("afterActionAnnotations", []):
        add(n.get("annotationNode", {}), "処理後", n.get("namespace", "Default"))
    if not result and node.get("baseType") == "transform":
        add(node, "加工")
    return result


def make_field(name, type_, origin, **extra):
    return {"name": name, "type": type_ or "unknown", "origin": origin,
            "status": "継承", "typeSource": "定義", "expression": None, **extra}


def find_name(fields, name):
    if name in fields:
        return name
    # Some legacy files serialize the same backslash twice in input schema.
    normalized = str(name).replace("\\\\", "\\")
    return next((k for k in fields if k.replace("\\\\", "\\") == normalized), name)


def pivot_details(node, fields):
    """Read saved pivot settings; resolve field names without evaluating data."""
    kind = short_type(node)
    result = {"direction": "rowsToColumns" if kind == "Pivot" else "columnsToRows",
              "retained": [], "groups": [], "notes": []}
    sources = set()
    if kind == "Pivot":
        pivot = node.get("pivotColumnName", "")
        measure = node.get("aggregateColumnName", "")
        result.update(pivotField=fields.get(pivot, {"name": pivot, "type": "unknown"}),
                      valueField=fields.get(measure, {"name": measure, "type": "unknown"}),
                      aggregation=node.get("defaultAggregation", ""),
                      newColumns=[c["newColumnName"] for c in node.get("newPivotColumns", []) if c.get("newColumnName")])
        sources.update([pivot, measure])
        if not result["newColumns"]:
            result["notes"].append("新しい列名は保存されていません。")
    elif kind == "UnpivotExtended":
        group = node.get("unpivotGroup") or {}
        literal = group.get("literalColumn") or {}
        columns = []
        for column in group.get("unpivotColumns", []):
            info = column.get("columnInformation") or {}
            pattern = None
            if info.get("bindingsType") == "manual" or info.get("manualBindings"):
                names = list(info.get("manualBindings", []))
            else:
                expression = info.get("wildcardExpression", "")
                mode = info.get("wildcardType", "Contains")
                pattern = {"type": mode, "expression": expression}
                matchers = {"Contains": lambda s: expression.casefold() in s.casefold(),
                            "Starts with": lambda s: s.casefold().startswith(expression.casefold()),
                            "Ends with": lambda s: s.casefold().endswith(expression.casefold())}
                match = matchers.get(mode)
                names = sorted((s for s in fields if match and match(s)), key=str.casefold)
                if match is None:
                    result["notes"].append("この検索条件の対象フィールドは、実行せずには確定できません。")
                names = list(dict.fromkeys(names + info.get("additionalColumns", [])))
            sources.update(names)
            columns.append({"name": column.get("unpivotColumnName", ""), "pattern": pattern,
                            "fields": [fields.get(s, {"name": s, "type": "unknown"}) for s in names]})
        names = literal.get("names") or ([f["name"] for f in columns[0]["fields"]] if columns else [])
        result["groups"].append({"name": literal.get("literalColumnName", ""),
                                 "values": literal.get("literals") or names, "columns": columns})
    elif kind == "Unpivot":
        for group in node.get("unpivotGroups", []):
            columns, values, literal_name = {}, [], ""
            for expression in group.get("expressions", []):
                for binding in expression.get("bindings", []):
                    if binding.get("bindingType") == "literal":
                        literal_name = binding.get("newColumnName", "")
                        values.append(binding.get("groupName", ""))
                    elif binding.get("bindingType") == "column":
                        name = binding.get("columnName", "")
                        sources.add(name)
                        columns.setdefault(binding.get("newColumnName", ""), []).append(
                            fields.get(name, {"name": name, "type": "unknown"}))
            result["groups"].append({"name": literal_name, "values": values,
                                     "columns": [{"name": k, "fields": v} for k, v in columns.items()]})
    result["retained"] = [f for k, f in fields.items() if k not in sources]
    if kind == "Pivot" and node.get("pivotGroupingColumns"):
        groups = [c if isinstance(c, str) else c.get("columnName", "") for c in node["pivotGroupingColumns"]]
        result["retained"] = [fields.get(c, {"name": c, "type": "unknown"}) for c in groups]
    return result


def apply_action(fields, op, owner, warnings, removed=None):
    fields = copy.deepcopy(fields)
    n = op["raw"]
    t = short_type(n)
    name = find_name(fields, n.get("columnName", ""))
    change = {"type": t, "label": action_label(n), "actionId": op.get("id", ""),
              "phase": op.get("phase"), "namespace": op.get("namespace"), "name": n.get("name", "")}

    def record(field, **extra):
        field.setdefault("changes", []).append({**change, **extra})

    if t in {"AddColumn", "QuickCalcColumn", "QuickDateNameCalcColumn", "MultiRowCalc", "DuplicateColumn"}:
        name = n.get("columnName", "")
        old = fields.get(name)
        fields[name] = make_field(name, infer_type(n.get("expression"), fields),
                                  old["origin"] if old else owner, status="変更" if old else "追加",
                                  typeSource="推定", expression=n.get("expression"), changedAt=owner)
        fields[name]["changes"] = copy.deepcopy(old.get("changes", [])) if old else []
        fields[name]["fieldKey"] = old.get("fieldKey", name) if old else "added:" + n.get("id", name)
        fields[name]["fieldOrder"] = old.get("fieldOrder", 100000) if old else 100000 + len(fields)
        record(fields[name], expression=n.get("expression"))
    elif t == "MergeColumns":
        target = n.get("mergedColumnName")
        sources = n.get("mergeColumnsList")
        if not isinstance(target, str) or not target or not isinstance(sources, list) or not sources or not all(isinstance(c, str) and c for c in sources):
            warnings.append("マージ対象または出力フィールド名が保存されていません。")
            return fields
        target = find_name(fields, target)
        names = list(dict.fromkeys([target] + [find_name(fields, c) for c in sources]))
        missing = [c for c in names if c not in fields]
        if missing:
            warnings.append("マージ対象のフィールドを復元できません: " + "、".join(missing))
        merged_field = copy.deepcopy(fields.get(target, make_field(target, "unknown", owner)))
        types = {fields[c]["type"] if c in fields else "unknown" for c in names}
        # The schema is known even when differing input types leave the result type uncertain.
        merged_field.update(type=next(iter(types)) if len(types) == 1 else "unknown",
                            typeSource="推定", status="統合", changedAt=owner, expression=None)
        merged_field.pop("expressionVariants", None)
        merged_field["origin"] = " / ".join(dict.fromkeys(fields[c]["origin"] for c in names if c in fields)) or owner
        merged_field["fieldKey"] = merged_field.get("fieldKey", "merged:" + n.get("id", target))
        merged_field["fieldOrder"] = merged_field.get("fieldOrder", 100000 + len(fields))
        record(merged_field, mergedFields=names)
        for col in names:
            if col != target and col in fields:
                deleted = fields.pop(col)
                record(deleted, mergedInto=target)
                if removed is not None:
                    removed.append({**deleted, "deleted": True, "status": "統合元", "namespace": op.get("namespace", "Default")})
        fields[target] = merged_field
    elif t == "RemoveColumns":
        for col in n.get("columnNames", []):
            deleted = fields.pop(find_name(fields, col), None)
            if deleted is not None and removed is not None:
                record(deleted)
                removed.append({**deleted, "deleted": True, "status": "削除", "namespace": op.get("namespace", "Default")})
    elif t == "RenameColumn":
        if name in fields:
            new_name = n.get("rename", name)
            record(fields[name], before=name, after=new_name)
            fields = {(new_name if k == name else k):
                      ({**v, "name": new_name, "status": "名前変更", "changedAt": owner} if k == name else v)
                      for k, v in fields.items()}
        else:
            warnings.append(f"名前変更の対象「{name}」を復元できません。")
    elif t == "ChangeColumnType":
        op["typeChanges"] = []
        for col, info in n.get("fields", {}).items():
            col = find_name(fields, col)
            op["typeChanges"].append({"field": col, "before": fields.get(col, {}).get("type", "unknown"),
                                      "after": info.get("type", "unknown")})
            if col in fields:
                record(fields[col], before=fields[col]["type"], after=info.get("type", "unknown"))
                fields[col].update(type=info.get("type", "unknown"), typeSource="定義", status="型変更", changedAt=owner)
                if info.get("calc"):
                    fields[col]["expression"] = info["calc"]
            else:
                warnings.append(f"型変更の対象「{col}」を復元できません。")
    elif t == "Aggregate":
        output = {}
        for spec in n.get("groupByFields", []) + n.get("aggregateFields", []):
            col = spec.get("columnName", "")
            new = spec.get("newColumnName") or col
            field = copy.deepcopy(fields.get(col, make_field(col, "unknown", owner)))
            field.update(name=new, status="集計" if spec.get("function") else "グループ", changedAt=owner)
            if spec.get("function"):
                field["expression"] = f"{spec['function']}([{col}])"
                field["typeSource"] = "推定"
                if spec["function"] in {"COUNT", "COUNTD"}:
                    field["type"] = "integer"
                elif spec["function"] in {"AVG", "MEDIAN"}:
                    field["type"] = "real"
            output[new] = field
        fields = output
    elif t in {"Unpivot", "UnpivotExtended", "Pivot"}:
        detail = pivot_details(n, fields)
        warnings.extend(detail["notes"])
        fields = {f["name"]: copy.deepcopy(f) for f in detail["retained"]}
        def add_pivot_field(name, type_):
            if name:
                fields[name] = make_field(name, type_, owner, status="ピボット", typeSource="推定", changedAt=owner)
        if t == "Pivot":
            type_ = detail["valueField"].get("type", "unknown")
            if detail["aggregation"] in {"COUNT", "COUNTD"}:
                type_ = "integer"
            elif detail["aggregation"] in {"AVG", "MEDIAN"}:
                type_ = "real"
            for col in detail["newColumns"]:
                add_pivot_field(col, type_)
        else:
            for group in detail["groups"]:
                add_pivot_field(group["name"], "string")
                for column in group["columns"]:
                    types = {f.get("type", "unknown") for f in column["fields"]}
                    type_ = next(iter(types)) if len(types) == 1 else "unknown"
                    if "unknown" not in types and "string" in types:
                        type_ = "string"
                    elif types == {"integer", "real"}:
                        type_ = "real"
                    add_pivot_field(column["name"], type_)
    elif t in {"RangeFilter", "ValueFilter", "Filter", "FilterOperation", "Remap"}:
        affected = ([name] if t == "Remap" else list(n.get("ranges", {})) if t == "RangeFilter"
                    else list(n.get("values", {})) if t == "ValueFilter" else field_ref(n.get(expression_key(n), "")))
        for col in affected:
            if col in fields:
                record(fields[col])
        if t == "Remap" and name in fields:
            fields[name].update(status="置換", changedAt=owner)
    else:
        warnings.append(f"{t} のフィールド変化は未対応です。設定・元の定義は表示できます。")
    return fields


def analyze(source, filename=None, package=None):
    start = time.perf_counter()
    file_size = None
    if isinstance(source, (str, Path)):
        file_size = Path(source).stat().st_size
    elif source is not None:
        position = source.tell()
        source.seek(0, io.SEEK_END)
        file_size = source.tell()
        source.seek(position)
    name, flow, display, metadata, entries = package if package is not None else read_package(source)
    name = filename or name
    nodes = flow["nodes"]
    order, unresolved = topo_order(nodes)
    incoming = {k: [] for k in nodes}
    edges, global_warnings = [], []
    for k, n in nodes.items():
        for e in n.get("nextNodes", []):
            target = e.get("nextNodeId")
            if target not in nodes:
                global_warnings.append(f"{n.get('name', k)} の接続先 {target} が見つかりません。")
                continue
            edge = {"source": k, "target": target, "namespace": e.get("nextNamespace", "Default"),
                    "sourceNamespace": e.get("namespace", "Default")}
            edges.append(edge)
            incoming[target].append(edge)
    settings = display.get("flowDisplaySettings", {}).get("flowNodeDisplaySettings", {}) or {}
    output, schemas, depths, rows = {}, {}, {}, Counter()
    def inherit(fields):
        return {k: {**copy.deepcopy(v), "status": "継承", "changes": []} for k, v in fields.items()}
    for key in order + unresolved:
        n = nodes[key]
        warnings = []
        if key in unresolved:
            warnings.append("循環または循環に依存するステップのため、フィールドを確定できません。")
        actions = get_actions(n, warnings)
        kind = kind_of(n)
        namespaces = {}
        inherited_warnings = []
        for e in incoming[key]:
            namespaces[e["namespace"]] = inherit(schemas.get(e["source"], {}))
            if output.get(e["source"], {}).get("schemaUncertain"):
                inherited_warnings.append(nodes[e["source"]].get("name", e["source"]))
        if inherited_warnings:
            warnings.append("上流でフィールド構成を確定できないステップがあります: " + "、".join(inherited_warnings))
        for ns, fs in namespaces.items():
            for i, (col, f) in enumerate(fs.items()):
                f.update(fieldKey=f"{key}:{ns}:{col}", fieldOrder=i, changes=[])
        fields = copy.deepcopy(next(iter(namespaces.values()), {}))
        if kind == "input":
            fields = {f["name"]: make_field(f["name"], f.get("type"), n.get("name", key), status="入力")
                      for f in n.get("fields", []) if isinstance(f, dict) and "name" in f}
            if not fields:
                warnings.append("入力フィールドが保存されていません。データ接続なしでは取得できません。")
            for i, (col, f) in enumerate(fields.items()):
                f.update(fieldKey=f"{key}:{col}", fieldOrder=i, changes=[])
        input_fields = copy.deepcopy(fields)
        if len(namespaces) > 1:
            input_fields = {f"{ns}:{k}": {**v, "namespace": ns} for ns, fs in namespaces.items() for k, v in fs.items()}
        removed_fields = []
        for op in actions:
            if op["phase"] == "処理前":
                ns = op["namespace"]
                if ns not in namespaces:
                    warnings.append(f"処理前の入力 {ns} が見つかりません。")
                namespaces[ns] = apply_action(namespaces.get(ns, {}), op, n.get("name", key), warnings, removed_fields)
            elif op["type"] == "SimpleJoin":
                fields = copy.deepcopy(namespaces.get("Left", {}))
                right = namespaces.get("Right", {})
                complex_collisions = []
                for col, f in right.items():
                    dest, i = col, 1
                    while dest in fields or (dest != col and dest in right):
                        if dest != col and dest in right:
                            complex_collisions.append(col)
                        dest = f"{col}-{i}"
                        i += 1
                    fields[dest] = {**copy.deepcopy(f), "name": dest, "status": "結合"}
                # Tableau documents -1/-2 suffixes for ordinary duplicate join fields.
                # Only retain uncertainty for a clash with another original right-hand name.
                if complex_collisions:
                    warnings.append("結合の重複名と右入力の既存の連番付きフィールド名が重なるため、名前を推定しています: " + "、".join(complex_collisions))
            elif op["type"] == "SimpleUnion":
                fields = {}
                mapping = {m["namespaceName"]: m.get("fieldMappings", {}) for m in op["raw"].get("namespaceFieldMappings", [])}
                for ns, fs in namespaces.items():
                    for col, field in fs.items():
                        dest = mapping.get(ns, {}).get(f"[{col}]", mapping.get(ns, {}).get(col, col))
                        if not isinstance(dest, str):
                            warnings.append("一部のユニオンのフィールド対応は未対応です。")
                            dest = col
                        if dest in fields:
                            prior = fields[dest]
                            if "expressionVariants" not in prior:
                                prior["expressionVariants"] = [{"source": prior["origin"], "expression": prior.get("expression")}]
                            prior["expressionVariants"].append({"source": field["origin"], "expression": field.get("expression")})
                            if len({v.get("expression") for v in prior["expressionVariants"]}) > 1:
                                prior["expression"] = None
                            fields[dest]["origin"] = " / ".join(dict.fromkeys((fields[dest]["origin"] + " / " + field["origin"]).split(" / ")))
                            if fields[dest]["type"] != field["type"]:
                                fields[dest].update(type="unknown", typeSource="未確定")
                        else:
                            fields[dest] = {**copy.deepcopy(field), "name": dest, "status": "統合"}
                fields.setdefault("Table Names", make_field("Table Names", "string", n.get("name", key), status="追加", typeSource="推定"))
            else:
                if op["phase"] == "主処理" and len(namespaces) == 1:
                    fields = copy.deepcopy(next(iter(namespaces.values())))
                if op["type"] in {"Unpivot", "UnpivotExtended", "Pivot"}:
                    op["pivot"] = pivot_details(op["raw"], fields)
                fields = apply_action(fields, op, n.get("name", key), warnings, removed_fields)
        if kind == "other" or ("loomContainer" in n and any(len(x.get("nextNodes", [])) > 1 for x in n["loomContainer"].get("nodes", {}).values())):
            warnings.append("このステップの出力フィールドは参考情報です。完全な復元は保証できません。")
        warnings = list(dict.fromkeys(warnings))
        schemas[key] = fields
        cfg = settings.get(key, {})
        pos = cfg.get("position") or {}
        depths[key] = max((depths.get(e["source"], 0) + 1 for e in incoming[key]), default=0)
        saved_position = isinstance(pos.get("x"), (int, float)) and isinstance(pos.get("y"), (int, float))
        if not saved_position:
            pos = {"x": depths[key], "y": rows[depths[key]]}
            rows[depths[key]] += 1
        color = (cfg.get("color") or {}).get("hexCss", "#499893")
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            color = "#499893"
        calculations = [{**expr, "phase": op["phase"], "namespace": op["namespace"], "actionName": op["name"],
                         "references": field_ref(expr["expression"])} for op in actions for expr in op["expressions"]]
        connection = flow.get("connections", {}).get(n.get("connectionId"), {})
        if connection:
            connection = {**connection, "id": connection.get("id") or n.get("connectionId")}
        output[key] = {"id": key, "name": n.get("name", key), "kind": kind, "kindLabel": TYPE_LABELS[kind],
                       "nodeType": n.get("nodeType"), "description": n.get("description"),
                       "position": pos, "savedPosition": saved_position, "color": color,
                       "fields": list(fields.values()), "inputFields": list(input_fields.values()),
                       "fieldInventory": sorted(
                           [{**f, "deleted": False} for f in fields.values()] + removed_fields,
                           key=lambda f: f.get("fieldOrder", 100000)),
                       "actions": actions, "calculations": calculations, "warnings": warnings,
                       "schemaUncertain": bool(warnings), "connection": connection,
                       "raw": n, "display": cfg, "properties": flow.get("nodeProperties", {}).get(key, {}),
                       "upstream": [e["source"] for e in incoming[key]],
                       "downstream": [e["target"] for e in edges if e["source"] == key]}
    if not settings:
        global_warnings.append("保存された配置情報がないため、接続順に自動配置しています。")
    result = {"name": name, "fileSizeBytes": file_size, "nodes": list(output.values()), "edges": edges,
              "connections": [{**c, "id": c.get("id") or key} for key, c in flow.get("connections", {}).items()],
              "parameters": flow.get("parameters", {}), "metadata": metadata,
              "entries": entries, "warnings": global_warnings,
              "stats": {"steps": len(nodes), "connections": len(flow.get("connections", {})),
                        "calculations": sum(len(n["calculations"]) for n in output.values()),
                        "actions": sum(len(n["actions"]) for n in output.values()),
                        "savedPositions": sum(n["savedPosition"] for n in output.values()),
                        "kinds": dict(Counter(n["kind"] for n in output.values()))},
              "formatVersion": f"{flow.get('majorVersion', '?')}.{flow.get('minorVersion', '?')}"}
    result["stats"]["parseMs"] = round((time.perf_counter() - start) * 1000, 1)
    return result


def render_html(model):
    template = (ROOT / "web" / "viewer.html").read_text(encoding="utf-8")
    css = (ROOT / "web" / "viewer.css").read_text(encoding="utf-8")
    icons = json.loads((ROOT / "web" / "prep-icons.json").read_text(encoding="utf-8"))
    js = "const PREP_ICONS = " + json.dumps(icons) + ";\n"
    js += "\n".join((ROOT / "web" / name).read_text(encoding="utf-8") for name in ("formula.js", "formula-format.js", "formula-edit.js", "filter-display.js", "comment-layout.js", "viewer.js"))
    # HTML raw-text script elements must never contain an untrusted closing tag.
    payload = json.dumps(model, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return template.replace("/* INLINE_CSS */", css).replace("/* INLINE_JS */", js).replace("__FLOW_DATA__", payload)


def export(source, destination):
    model = analyze(source)
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(render_html(model), encoding="utf-8")
    return model


def sample_files():
    """Only offer direct .tflx children of the samples directory."""
    directory = (ROOT / "samples").resolve()
    if not directory.is_dir():
        return {}
    return {p.name: p for p in sorted(directory.iterdir(), key=lambda p: p.name.casefold())
            if p.suffix.lower() == ".tflx" and p.is_file() and p.resolve().parent == directory}


def file_revision(path):
    import hashlib
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024**2), b""):
            digest.update(chunk)
    return digest.hexdigest()


def default_flow_directory():
    recent = RecentFlows().list()
    if recent:
        return Path(recent[0]["path"]).parent
    documents = Path.home() / "Documents"
    return documents if documents.is_dir() else Path.home()


def choose_flow_file(title="Tableau Prep フローを開く"):
    from native_dialogs import choose_file
    return choose_file(title=title, directory=default_flow_directory())


def apply_formula_change(flow, change):
    node = flow["nodes"].get(change.get("stepId"))
    if node is None:
        raise ValueError("保存対象のステップが見つかりません。")
    actions = [a for a in get_actions(node, []) if a["id"] == change.get("actionId")]
    if len(actions) != 1:
        raise ValueError("保存対象の処理を一意に特定できません。")
    raw = actions[0]["raw"]
    if short_type(raw) == "ChangeColumnType":
        target, key = raw.get("fields", {}).get(change.get("field"), {}), "calc"
    else:
        target, key = raw, expression_key(raw)
        if change.get("field") != raw.get("columnName", "条件式"):
            raise ValueError("保存対象のフィールドが一致しません。")
    if not isinstance(target.get(key), str) or target[key] != change.get("before"):
        raise ValueError("計算式が読み込み時から変更されています。開き直してから保存してください。")
    expression = change.get("expression")
    if not isinstance(expression, str) or not expression.strip() or len(expression.encode("utf-8")) > 1024**2:
        raise ValueError("計算式は空にせず、1MB以内で入力してください。")
    target[key] = expression


def choose_save_file(path, name, temporary=False):
    from native_dialogs import choose_file
    return choose_file(title="フローの変更を保存", save=True,
                       directory=default_flow_directory() if temporary else Path(path).parent,
                       filename=Path(name).name)


def save_formula_file(path, revision, change, destination=None):
    """Atomically save confirmed expressions, preserving other package members."""
    import os
    import shutil
    import tempfile
    path = Path(path)
    destination = Path(destination) if destination else path
    if destination.suffix.lower() != path.suffix.lower():
        raise ValueError("元のフローと同じ拡張子で保存してください。")
    if file_revision(path) != revision:
        raise ValueError("ファイルが別の場所で変更されています。開き直してから保存してください。")
    destination_revision = file_revision(destination) if destination.exists() else None
    _, flow, _, metadata, _ = read_package(path)
    for edit in change if isinstance(change, list) else [change]:
        apply_formula_change(flow, edit)
    encoded = json.dumps(flow, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    fd, temporary = tempfile.mkstemp(prefix=".prepflow-", suffix=path.suffix, dir=destination.parent)
    os.close(fd)
    temporary = Path(temporary)
    try:
        if zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as original, zipfile.ZipFile(temporary, "w") as updated:
                entry = metadata.get("flowEntryName", "flow")
                candidates = [i for i in original.infolist() if i.filename == entry or i.filename.rsplit("/", 1)[-1] == entry]
                if len(candidates) != 1:
                    raise ValueError("書き換えるフロー定義を一意に特定できません。")
                updated.comment = original.comment
                for info in original.infolist():
                    clone = copy.copy(info)
                    if info.filename == candidates[0].filename:
                        updated.writestr(clone, encoded)
                    else:
                        with original.open(info) as source, updated.open(clone, "w", force_zip64=info.file_size >= zipfile.ZIP64_LIMIT) as member:
                            shutil.copyfileobj(source, member, 1024**2)
        else:
            temporary.write_bytes(encoded)
        result = analyze(temporary, filename=destination.name)
        with temporary.open("r+b") as stream:
            os.fsync(stream.fileno())
        shutil.copymode(path, temporary)
        if file_revision(path) != revision:
            raise ValueError("保存中に元ファイルが変更されました。上書きせず中止しました。")
        if (file_revision(destination) if destination.exists() else None) != destination_revision:
            raise ValueError("保存先が別の場所で変更されました。上書きせず中止しました。")
        new_revision = file_revision(temporary)
        os.replace(temporary, destination)
        return result, new_revision
    finally:
        temporary.unlink(missing_ok=True)


def empty_model():
    return {"name": "PrepFlow Viewer", "fileSizeBytes": None, "nodes": [], "edges": [], "connections": [],
            "parameters": {}, "metadata": {}, "entries": [], "warnings": [],
            "stats": {"steps": 0, "connections": 0, "calculations": 0, "actions": 0,
                      "savedPositions": 0, "parseMs": 0, "kinds": {}}, "formatVersion": "—"}


def open_source_folder(source_info):
    """Open only a registered flow's directory, never a path supplied by the page."""
    from native_explorer import worker
    if not source_info or source_info.get("temporary"):
        raise ValueError("保存場所が未確定です。先にフローを保存してください。")
    folder = Path(source_info["path"]).resolve().parent
    if not folder.is_dir():
        raise ValueError("保存先のフォルダーが見つかりません。移動または削除された可能性があります。")
    worker.open(folder)


def serve(source=None, port=8765, open_browser=True, resume=None, history_path=None, on_ready=None):
    """Loopback-only viewer/editor. Writes require a selected source and revision."""
    import secrets
    import tempfile
    import threading
    import webbrowser
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    from urllib.parse import unquote, quote

    recent = RecentFlows(history_path)
    recent_files = recent.list()
    if source is None and recent_files:
        source = Path(recent_files[0]["path"])
    token = resume["token"] if resume else secrets.token_urlsafe(32)
    exports, edit_sources = {}, {}
    # Successful destinations belong to this running Viewer, never to the flow file.
    publish_history = {}
    export_lock = threading.Lock()
    edit_lock = threading.Lock()
    picker_lock = threading.Lock()
    publish_lock = threading.Lock()
    uploaded_files = tempfile.TemporaryDirectory(prefix="prepflow-")
    if source and Path(source).is_file():
        recent.add(source)

    def register_export(model, path=None, temporary=False):
        key = secrets.token_urlsafe(24)
        model["exportKey"] = key
        if path is not None:
            model["editRevision"] = file_revision(path)
            edit_sources[key] = {"path": Path(path).resolve(), "temporary": temporary, "package": read_package(path)}
            if not temporary:
                model.update(sourcePath=str(Path(path).resolve()), recentId=recent.identity(path))
                recent.add(path)
        with export_lock:
            exports[key] = model
            while len(exports) > 12:
                old = next((k for k in exports if k != key and not edit_sources.get(k, {}).get("edited")), None)
                if old is None:
                    break
                exports.pop(old)
                discarded = edit_sources.pop(old, None)
                if discarded and discarded["temporary"]:
                    discarded["path"].unlink(missing_ok=True)

    def open_flow_path(path):
        # Also used by native drops; retain the source, not a temporary upload copy.
        path = Path(path).resolve()
        if path.suffix.lower() not in {".tfl", ".tflx"}:
            raise ValueError(".tflx または .tfl ファイルを選択してください。")
        if not path.is_file():
            raise ValueError("フローファイルが見つかりません。移動または削除されていないか確認してください。")
        result = analyze(path)
        result["sampleName"] = next((name for name, p in sample_files().items() if p.resolve() == path), None)
        register_export(result, path)
        return result

    # An explicit local recovery snapshot preserves an already-open browser session.
    for session in (resume or {}).get("sessions", []):
        model, path = session["model"], Path(session["path"]).resolve()
        model.update(sourcePath=str(path), recentId=recent.identity(path))
        if file_revision(path) != model["editRevision"]:
            raise ValueError("復元対象の元ファイルが変更されています。")
        key = model["exportKey"]
        exports[key] = model
        edit_sources[key] = {"path": path, "temporary": False, "edited": True,
                             "package": read_package(path)}
    def opening_page():
        # Browser reopening also uses the latest history, without restarting Python.
        items = recent.list()
        model = empty_model()
        if items:
            path = Path(items[0]["path"])
            try:
                model = analyze(path)
                register_export(model, path)
            except (ValueError, OSError, KeyError, TypeError, RuntimeError, zipfile.BadZipFile) as exc:
                model = empty_model()
                model["openingError"] = f"直近のフローを読み込めませんでした: {exc}"
        return render_html(model).replace(
            '<script id="server-config" type="application/json">{}</script>',
            '<script id="server-config" type="application/json">' + json.dumps({"token": token}) + '</script>',
        ).encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format_, *args):
            pass  # Do not log file names, definitions or request bodies.

        def respond(self, status, payload, content_type="application/json; charset=utf-8", download_name=None):
            body = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            if download_name:
                self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(download_name, safe=""))
            self.end_headers()
            self.wfile.write(body)

        def local_request(self):
            return self.headers.get("Host") in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

        def do_GET(self):
            if not self.local_request():
                return self.respond(403, {"error": "ローカルの画面からアクセスしてください。"})
            if self.path == "/":
                return self.respond(200, opening_page(), "text/html; charset=utf-8")
            if self.path == "/health":
                return self.respond(200, {"status": "ok", "app": "PrepFlowViewer"})
            if self.path == "/api/samples":
                if not secrets.compare_digest(self.headers.get("X-Viewer-Token", ""), token):
                    return self.respond(403, {"error": "ビューアーからアクセスしてください。"})
                return self.respond(200, {"samples": list(sample_files())})
            if self.path == "/api/recent":
                if not secrets.compare_digest(self.headers.get("X-Viewer-Token", ""), token):
                    return self.respond(403, {"error": "ビューアーからアクセスしてください。"})
                return self.respond(200, {"recent": recent.list()})
            if self.path.startswith("/export/"):
                with export_lock:
                    model = exports.get(self.path.removeprefix("/export/"))
                if model:
                    return self.respond(200, render_html(model).encode("utf-8"), "text/html; charset=utf-8", Path(model["name"]).stem + ".html")
                return self.respond(404, {"error": "保存期限が切れました。フローを開き直してください。"})
            self.respond(404, {"error": "Not found"})

        def do_POST(self):
            expected_origins = {f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}"}
            if not self.local_request() or not secrets.compare_digest(self.headers.get("X-Viewer-Token", ""), token) or self.headers.get("Origin") not in expected_origins:
                return self.respond(403, {"error": "起動したビューアー画面からファイルを開いてください。"})
            if self.path in {"/api/publish/defaults", "/api/publish/test-auth", "/api/publish/start"}:
                from tableau_publish import PublishSettings, credentials, project_default, run_publish, safe_error
                values = {}
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 4 * 1024**2:
                        raise ValueError("リクエストのサイズが正しくありません。")
                    payload = json.loads(self.rfile.read(length))
                    if not isinstance(payload, dict):
                        raise ValueError("リクエストの形式が正しくありません。")
                    settings = PublishSettings()
                    with export_lock:
                        source_info = edit_sources.get(payload.get("exportKey"))
                        model = exports.get(payload.get("exportKey"))
                        last_publish = publish_history.get(source_info['path'], {}) if source_info else {}
                    if self.path == "/api/publish/defaults":
                        return self.respond(200, {**settings.load(),
                            "name": Path(model['name']).stem if model else '',
                            "project": project_default(source_info['package']) if source_info else '',
                            **last_publish})
                    values = credentials(payload)
                    publish = self.path == "/api/publish/start"
                    if publish:
                        if not source_info or not model or payload.get('revision') != model.get('editRevision'):
                            raise ValueError("フローを開き直してからパブリッシュしてください。")
                        for key in ('name', 'project'):
                            if not isinstance(payload.get(key), str) or not payload[key].strip() or len(payload[key]) > 4096:
                                raise ValueError("パブリッシュ名とパブリッシュ先を入力してください。")
                        changes = payload.get('changes', [])
                        if not isinstance(changes, list) or len(changes) > 2000:
                            raise ValueError("変更内容の形式が正しくありません。")
                    if not publish_lock.acquire(blocking=False):
                        return self.respond(409, {"error": "パブリッシュ操作を実行中です。完了までお待ちください。"})
                except Exception as exc:
                    return self.respond(400, {"error": safe_error(exc, values)})
                # A line stream keeps progress visible while TSC uploads a flow.
                try:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/x-ndjson; charset=utf-8')
                    self.send_header('Cache-Control', 'no-store')
                    self.send_header('Connection', 'close')
                    self.end_headers()
                    self.close_connection = True
                    def send(event):
                        try:
                            self.wfile.write((json.dumps(event, ensure_ascii=False) + '\n').encode('utf-8'))
                            self.wfile.flush()
                        except OSError:
                            pass  # Finish an already-started publication even if the UI disconnects.
                    def log(message, level='info'):
                        send({'message': message, 'level': level})
                    try:
                        if publish:
                            with tempfile.TemporaryDirectory(prefix='prepflow-publish-') as folder:
                                snapshot = Path(folder) / ('flow' + source_info['path'].suffix.lower())
                                log('現在のフローを準備中（確定済みの編集を含みます）…')
                                with edit_lock:
                                    save_formula_file(source_info['path'], model['editRevision'], changes, snapshot)
                                run_publish(values, settings, log, source=snapshot, name=payload['name'].strip(), project=payload['project'])
                                with export_lock:
                                    publish_history[source_info['path']] = {
                                        'name': payload['name'].strip(), 'project': payload['project'].strip()}
                        else:
                            run_publish(values, settings, log)
                        send({'done': True, 'ok': True})
                    except Exception as exc:
                        log(safe_error(exc, values), 'error')
                        send({'done': True, 'ok': False})
                finally:
                    publish_lock.release()
                return
            if self.path in {"/api/open", "/api/recent/open", "/api/open-folder", "/api/preview-edits", "/api/save-flow"}:
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 4 * 1024**2:
                        raise ValueError("保存リクエストのサイズが正しくありません。")
                    payload = json.loads(self.rfile.read(length))
                    if not isinstance(payload, dict):
                        raise ValueError("リクエストの形式が正しくありません。")
                    if self.path == "/api/open-folder":
                        with export_lock:
                            source_info = edit_sources.get(payload.get("exportKey"))
                        open_source_folder(source_info)
                        return self.respond(200, {"opened": True})
                    if self.path in {"/api/open", "/api/recent/open"}:
                        if self.path == "/api/recent/open":
                            path = recent.find(payload.get("id"))
                            if path is None:
                                return self.respond(404, {"error": "フローファイルが見つかりません。移動または削除されたため、最近のフローから除外しました。"})
                        else:
                            with picker_lock:
                                path = choose_flow_file()
                            if path is None:
                                return self.respond(200, {"cancelled": True})
                        return self.respond(200, open_flow_path(path))
                    with edit_lock:
                        key = payload.get("exportKey")
                        with export_lock:
                            model, source_info = exports.get(key), edit_sources.get(key)
                        if model is None or source_info is None:
                            raise ValueError("保存元ファイルの情報がありません。フローを開き直してください。")
                        if payload.get("revision") != model.get("editRevision"):
                            raise ValueError("フローが更新されています。開き直してから保存してください。")
                        changes = payload.get("changes")
                        if not isinstance(changes, list) or len(changes) > 2000:
                            raise ValueError("変更内容の形式が正しくありません。")
                        if self.path == "/api/preview-edits":
                            package = copy.deepcopy(source_info["package"])
                            for change in changes:
                                apply_formula_change(package[1], change)
                            result = analyze(None, filename=model["name"], package=package)
                            result["fileSizeBytes"] = model.get("fileSizeBytes")
                            revision = model["editRevision"]
                            sample_name = model.get("sampleName")
                            source_info["edited"] = True
                        else:
                            with picker_lock:
                                destination = choose_save_file(source_info["path"], model["name"], source_info["temporary"])
                            if destination is None:
                                return self.respond(200, {"cancelled": True})
                            result, revision = save_formula_file(source_info["path"], model["editRevision"], changes, destination)
                            source_info = {"path": destination, "temporary": False, "package": read_package(destination), "edited": True}
                            recent.add(destination)
                            sample_name = next((name for name, p in sample_files().items() if p.resolve() == destination), None)
                        result.update(exportKey=key, editRevision=revision, sampleName=sample_name)
                        if not source_info["temporary"]:
                            result.update(sourcePath=str(source_info["path"]), recentId=recent.identity(source_info["path"]))
                        with export_lock:
                            exports[key] = result
                            edit_sources[key] = source_info
                        return self.respond(200, result)
                except (ValueError, OSError, KeyError, TypeError, AttributeError, RuntimeError, RecursionError, zipfile.BadZipFile) as exc:
                    return self.respond(400, {"error": str(exc)})
            if self.path == "/api/sample":
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 8192:
                        return self.respond(400, {"error": "サンプルを選択してください。"})
                    self.connection.settimeout(120)
                    payload = json.loads(self.rfile.read(length))
                    name = payload.get("name") if isinstance(payload, dict) else None
                    path = sample_files().get(name) if isinstance(name, str) else None
                    if path is None:
                        return self.respond(404, {"error": "samples 内にファイルが見つかりません。一覧を開き直してください。"})
                    result = analyze(path)
                    result["sampleName"] = name
                    register_export(result, path)
                    return self.respond(200, result)
                except (ValueError, OSError, KeyError, TypeError, AttributeError, RuntimeError, RecursionError, zipfile.BadZipFile) as exc:
                    return self.respond(400, {"error": f"フローを読み込めませんでした: {exc}"})
            if self.path != "/api/analyze":
                return self.respond(404, {"error": "Not found"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 2 * 1024**3:
                    return self.respond(413, {"error": "空のファイル、または2GBを超えるファイルです。大きいファイルはPythonの変換コマンドを使用してください。"})
                filename = unquote(self.headers.get("X-File-Name", "flow.tflx"))
                if not filename.lower().endswith((".tflx", ".tfl")):
                    return self.respond(400, {"error": ".tflx または .tfl を選択してください。"})
                self.connection.settimeout(120)
                retained = Path(uploaded_files.name) / (secrets.token_hex(16) + Path(filename).suffix)
                with retained.open("w+b") as spool:
                    remaining = length
                    while remaining:
                        chunk = self.rfile.read(min(1024**2, remaining))
                        if not chunk:
                            raise ValueError("ファイルの受信が途中で終了しました。")
                        spool.write(chunk)
                        remaining -= len(chunk)
                    spool.seek(0)
                    result = analyze(spool, filename=filename)
                register_export(result, retained, temporary=True)
                self.respond(200, result)
            except (ValueError, OSError, KeyError, TypeError, AttributeError, RuntimeError, RecursionError, zipfile.BadZipFile) as exc:
                self.respond(400, {"error": f"フローを読み込めませんでした: {exc}"})

    class LocalServer(ThreadingHTTPServer):
        allow_reuse_address = False

        def server_bind(self):
            import socket
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            super().server_bind()

    server = LocalServer(("127.0.0.1", port), Handler)
    server.open_flow_path = open_flow_path
    from native_explorer import worker
    worker.warm()
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"PrepFlow Viewer: {url}\nClose this window or press Ctrl+C to stop.", flush=True)
    if open_browser:
        threading.Timer(.4, lambda: webbrowser.open(url)).start()
    try:
        if on_ready:
            on_ready(server, url)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        worker.close()
        uploaded_files.cleanup()


def main():
    parser = argparse.ArgumentParser(description="Tableau Prepのフローをデータ接続なしでHTMLに変換します。")
    parser.add_argument("flow", nargs="?", type=Path)
    parser.add_argument("-o", "--output", type=Path)
    parser.add_argument("--open", action="store_true", help="生成したHTMLをブラウザで開く")
    parser.add_argument("--pick", action="store_true", help="ファイル選択画面を表示")
    parser.add_argument("--serve", action="store_true", help="ドラッグ＆ドロップできるローカル画面を起動")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="サーバー起動時にブラウザを開かない")
    args = parser.parse_args()
    if args.pick:
        selected = choose_flow_file("Tableau Prep フローを選択")
        if not selected:
            return
        args.flow = Path(selected)
    source = args.flow or ROOT / "samples" / "Superstore.tflx"
    if args.serve:
        try:
            serve(args.flow, args.port, not args.no_browser)
        except OSError as exc:
            parser.exit(1, f"起動できませんでした。すでに起動中なら http://127.0.0.1:{args.port} を開いてください。\n{exc}\n")
        return
    destination = args.output or ROOT / "output" / (source.stem + ".html")
    try:
        model = export(source, destination)
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile, RuntimeError) as exc:
        parser.exit(1, f"読み込みに失敗しました: {exc}\n")
    print(f"{destination.resolve()}\n{model['stats']['steps']} steps / {model['stats']['calculations']} calculations / {model['stats']['parseMs']} ms")
    if args.open:
        import webbrowser
        webbrowser.open(destination.resolve().as_uri())


if __name__ == "__main__":
    main()
