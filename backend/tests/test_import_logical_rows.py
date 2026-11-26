"""CSV/XLSX record limits apply to nonempty rows, preserving valid trailing records."""
import asyncio
import io
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from openpyxl import Workbook


class LogicalRowLimitTests(unittest.TestCase):
    def test_trailing_data_after_blanks_and_real_overflow(self):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        with patch.dict(os.environ, MONGO_URL="mongodb://127.0.0.1:27017", DB_NAME="parser_fixture"):
            from imports import _parse_file, MAX_ROWS
        for extension in ("csv", "xlsx"):
            def parse(rows):
                stream = io.BytesIO()
                if extension == "csv":
                    stream.write(("\n".join(rows) + "\n").encode())
                else:
                    book = Workbook()
                    for row in rows:
                        book.active.append([row])
                    book.save(stream)
                    book.close()
                stream.seek(0)
                return asyncio.run(_parse_file(UploadFile(filename="test."+extension, file=stream)))

            with self.subTest(extension=extension):
                head, lines = parse(["name", "first", *([""] * MAX_ROWS), "last"])
                self.assertEqual(head, ["name"])
                self.assertEqual(lines, [["first"], ["last"]])
                head, lines = parse(["name", *(["row"] * MAX_ROWS), "", ""])
                self.assertEqual(len(lines), MAX_ROWS)
                with self.assertRaises(HTTPException) as error:
                    parse(["name", "", *(["row"] * MAX_ROWS), "", "one too many"])
                self.assertEqual(error.exception.detail, "IMPORT_TOO_MANY_ROWS")
