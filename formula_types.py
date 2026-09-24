"""Conservative result-type inference from syntax; never evaluates a formula or data.

Branch merging follows Tableau's IF/CASE/IIF and IFNULL return-value rules:
https://help.tableau.com/current/pro/desktop/en-us/functions_functions_logical.htm
Unrecognised syntax and unresolved result types remain unknown.
"""
import re


TOKEN = re.compile(r'''
    (?P<skip>\s+|//[^\r\n]*|/\*.*?\*/)
    |(?P<string>"(?:\\.|""|[^"\\])*"|'(?:\\.|''|[^'\\])*')
    |(?P<field>\[(?:\]\]|[^\]])+\])
    |(?P<date>\#[^\#]+\#)
    |(?P<number>(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)
    |(?P<word>[^\W\d]\w*)
    |(?P<symbol><=|>=|<>|!=|==|[(),+*/%^=<>!\-])
    |(?P<invalid>.)
''', re.X | re.S)
NUMERIC = {'integer', 'real'}
PRECEDENCE = {'OR': 1, 'AND': 2, '=': 3, '==': 3, '!=': 3, '<>': 3,
              '<': 3, '>': 3, '<=': 3, '>=': 3, 'IN': 3,
              '+': 4, '-': 4, '*': 5, '/': 5, '%': 5, '^': 6}
# Fixed output types, with supported argument counts (not argument validation).
FUNCTIONS = {}
for result, specs in {
    'string': {'STR': (1, 1), 'TRIM': (1, 1), 'LTRIM': (1, 1), 'RTRIM': (1, 1),
               'SPLIT': (3, 3), 'REPLACE': (3, 3), 'REGEXP_REPLACE': (3, 3),
               'REGEXP_EXTRACT': (2, 2), 'UPPER': (1, 1), 'LOWER': (1, 1),
               'LEFT': (2, 2), 'RIGHT': (2, 2), 'MID': (2, 3), 'DATENAME': (2, 3)},
    'integer': {'INT': (1, 1), 'YEAR': (1, 1), 'MONTH': (1, 1), 'DAY': (1, 1),
                'DATEDIFF': (3, 4), 'DATEPART': (2, 3), 'LEN': (1, 1),
                'FIND': (2, 3), 'FINDNTH': (3, 3), 'COUNT': (1, 1), 'COUNTD': (1, 1)},
    'real': {'FLOAT': (1, 1), 'ROUND': (1, 2)},
    'date': {'DATE': (1, 1), 'MAKEDATE': (3, 3), 'TODAY': (0, 0)},
    'datetime': {'DATETIME': (1, 1), 'DATEPARSE': (2, 2), 'NOW': (0, 0)},
    'boolean': {'ISNULL': (1, 1), 'ISDATE': (1, 1), 'CONTAINS': (2, 2),
                'STARTSWITH': (2, 2), 'ENDSWITH': (2, 2), 'REGEXP_MATCH': (2, 2)},
}.items():
    FUNCTIONS.update({name: (result, low, high) for name, (low, high) in specs.items()})


def merged(types):
    # NULL adds no competing type; unknown is different and must not be discarded.
    known = set(types) - {'null'}
    if not known:
        return 'null'
    if 'unknown' in known:
        return 'unknown'
    if len(known) == 1:
        return next(iter(known))
    return 'real' if known <= NUMERIC else 'unknown'


def function_type(name, args):
    if name in FUNCTIONS:
        result, low, high = FUNCTIONS[name]
        return result if low <= len(args) <= high else 'unknown'
    if name == 'IIF' and len(args) in (3, 4):
        return merged(args[1:])
    if name == 'IFNULL' and len(args) == 2:
        return merged(args)
    if name in {'MIN', 'MAX'} and len(args) in (1, 2):
        return merged(args)
    if name in {'ZN', 'ABS', 'SUM'} and len(args) == 1:
        return args[0] if args[0] in NUMERIC else 'unknown'
    if name == 'DATEADD' and len(args) == 3:
        return args[2] if args[2] in {'date', 'datetime'} else 'unknown'
    if name == 'DATETRUNC' and len(args) in (2, 3):
        return args[1] if args[1] in {'date', 'datetime'} else 'unknown'
    return 'unknown'


class TypeParser:
    def __init__(self, tokens, fields):
        self.tokens, self.fields, self.pos, self.depth = tokens, fields, 0, 0

    def peek(self):
        if self.pos == len(self.tokens):
            return ''
        kind, text = self.tokens[self.pos]
        return text.upper() if kind in {'word', 'symbol'} else ''

    def take(self, value):
        if self.peek() == value:
            self.pos += 1
            return True
        return False

    def require(self, value):
        if not self.take(value):
            raise ValueError('Unsupported or incomplete expression')

    def expression(self, minimum=0):
        self.depth += 1
        try:
            if self.depth > 100:
                raise ValueError('Expression nesting is too deep')
            left = self.atom()
            while self.peek() in PRECEDENCE and PRECEDENCE[self.peek()] >= minimum:
                op = self.peek()
                self.pos += 1
                if op == 'IN':
                    self.require('(')
                    self.expression()
                    while self.take(','):
                        self.expression()
                    self.require(')')
                    left = 'boolean'
                    continue
                right = self.expression(PRECEDENCE[op] + (op != '^'))
                if PRECEDENCE[op] <= 3:
                    left = 'boolean'
                elif left in NUMERIC and right in NUMERIC:
                    left = 'real' if op in {'/', '^'} else merged([left, right])
                elif op == '+' and left == right == 'string':
                    left = 'string'
                else:
                    left = 'unknown'
            return left
        finally:
            self.depth -= 1

    def atom(self):
        if self.pos >= len(self.tokens):
            raise ValueError('Missing expression')
        if self.take('('):
            result = self.expression()
            self.require(')')
            return result
        if self.take('NOT'):
            self.expression(3)
            return 'boolean'
        if self.peek() in {'+', '-'}:
            self.pos += 1
            result = self.expression(6)
            return result if result in NUMERIC else 'unknown'
        if self.take('IF'):
            results = []
            while True:
                self.expression()  # The condition is not the return type.
                self.require('THEN')
                results.append(self.expression())
                if not self.take('ELSEIF'):
                    break
            if self.take('ELSE'):
                results.append(self.expression())
            self.require('END')
            return merged(results)
        if self.take('CASE'):
            self.expression()
            results = []
            while self.take('WHEN'):
                self.expression()
                self.require('THEN')
                results.append(self.expression())
            if not results:
                raise ValueError('Missing CASE branch')
            if self.take('ELSE'):
                results.append(self.expression())
            self.require('END')
            return merged(results)
        kind, text = self.tokens[self.pos]
        self.pos += 1
        if kind == 'field':
            return self.fields.get(text[1:-1].replace(']]', ']'), {}).get('type', 'unknown')
        if kind == 'number':
            return 'real' if any(c in text.lower() for c in '.e') else 'integer'
        if kind == 'string':
            return 'string'
        if kind == 'date':
            return 'datetime' if ':' in text else 'date'
        if kind == 'word':
            word = text.upper()
            if word in {'TRUE', 'FALSE'}:
                return 'boolean'
            if word == 'NULL':
                return 'null'
            if self.take('('):
                args = []
                if not self.take(')'):
                    args.append(self.expression())
                    while self.take(','):
                        args.append(self.expression())
                    self.require(')')
                return function_type(word, args)
        raise ValueError('Unsupported expression')


def infer_type(expression, fields):
    if not isinstance(expression, str) or len(expression) > 1024 * 1024:
        return 'unknown'
    # Retain support for Prep's serialized rank calculation syntax.
    if re.fullmatch(r'\s*\{\{.*:\s*(?:RANK|RANK_DENSE|ROW_NUMBER)\(\s*\)\s*\}\}\s*', expression, re.I | re.S):
        return 'integer'
    tokens = []
    for match in TOKEN.finditer(expression):
        kind = match.lastgroup
        if kind == 'invalid':
            return 'unknown'
        if kind != 'skip':
            tokens.append((kind, match[0]))
            if len(tokens) > 50000:
                return 'unknown'
    parser = TypeParser(tokens, fields)
    try:
        result = parser.expression()
        return result if parser.pos == len(tokens) and result != 'null' else 'unknown'
    except (ValueError, RecursionError):
        return 'unknown'
