import json
import tempfile
import unittest
from pathlib import Path

from recent_flows import RecentFlows


class RecentFlowsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.storage = self.root / 'settings/recent.json'
        self.history = RecentFlows(self.storage)

    def flow(self, name):
        path = self.root / name
        path.write_text('{}', encoding='utf-8')
        return path

    def test_empty_history_does_not_seed_samples(self):
        self.assertEqual(self.history.list(), [])

    def test_ten_newest_persist_reopening_moves_to_front(self):
        paths = [self.flow(f'flow-{i}.tflx') for i in range(12)]
        for path in paths:
            self.history.add(path)
        restored = RecentFlows(self.storage)
        self.assertEqual([x['name'] for x in restored.list()], [f'flow-{i}.tflx' for i in range(11, 1, -1)])
        restored.add(paths[5])
        items = restored.list()
        self.assertEqual(items[0]['name'], 'flow-5.tflx')
        self.assertEqual(len(items), 10)
        self.assertEqual(len({x['id'] for x in items}), 10)

    def test_missing_paths_removed_before_listing_and_selection(self):
        first, second = self.flow('first.tfl'), self.flow('second.tflx')
        self.history.add(first)
        self.history.add(second)
        key = self.history.identity(second)
        second.unlink()
        self.assertIsNone(self.history.find(key))
        self.assertEqual([x['name'] for x in self.history.list()], ['first.tfl'])
        self.assertEqual(json.loads(self.storage.read_text(encoding='utf-8')), [str(first)])

    def test_same_name_different_folder_remain_distinct(self):
        first = self.flow('same.tflx')
        second = self.root / 'other/same.tflx'
        second.parent.mkdir()
        second.write_text('{}')
        self.history.add(first)
        self.history.add(second)
        self.assertEqual(len(self.history.list()), 2)

    def test_malformed_and_invalid_history(self):
        self.storage.parent.mkdir()
        self.storage.write_text('invalid')
        self.assertEqual(self.history.list(), [])
        path = self.flow('ok.tfl')
        self.storage.write_text(json.dumps([None, 3, 'relative.tfl', str(path), str(path), str(self.root)]))
        self.assertEqual([x['path'] for x in self.history.list()], [str(path)])


if __name__ == '__main__':
    unittest.main()
