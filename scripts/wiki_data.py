"""Read public MediaWiki data tables without executing Lua.

Only return + literal tables, strings, numbers and booleans are accepted.
The wiki's renderer code is neither executed nor included in the product.
"""
import json
import re
from pathlib import Path


TOKEN = re.compile(r'\s*(?:(--[^\n]*(?:\n|$))|("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')|(-?\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z_0-9]*)|([{}\[\]=,;]))')


class LiteralLua:
    def __init__(self, text):
        self.tokens = []
        pos = 0
        while pos < len(text):
            m = TOKEN.match(text, pos)
            if not m:
                if not text[pos:].strip():
                    break
                raise ValueError(f'Unsupported Lua syntax near {text[pos:pos+60]!r}')
            pos = m.end()
            if m[1] is None:
                self.tokens.append(next(x for x in m.groups()[1:] if x is not None))
        self.pos = 0

    def pop(self, expected=None):
        token = self.tokens[self.pos]
        self.pos += 1
        if expected is not None and token != expected:
            raise ValueError(f'Expected {expected!r}, got {token!r}')
        return token

    def peek(self, offset=0):
        return self.tokens[self.pos+offset] if self.pos+offset < len(self.tokens) else None

    def value(self):
        token = self.pop()
        if token == '{':
            result, counter = {}, 1
            while self.peek() != '}':
                if self.peek() == '[':
                    self.pop('[')
                    key = self.value()
                    self.pop(']')
                    self.pop('=')
                elif self.peek(1) == '=':
                    key = self.pop()
                    self.pop('=')
                else:
                    key, counter = counter, counter+1
                if key in result:
                    raise ValueError(f'Duplicate Lua key {key}')
                result[key] = self.value()
                if self.peek() in (',', ';'):
                    self.pop()
                elif self.peek() != '}':
                    raise ValueError('Missing table separator')
            self.pop('}')
            if result and set(result) == set(range(1, len(result)+1)):
                return [result[i] for i in range(1, len(result)+1)]
            return result
        if token in ('true', 'false'):
            return token == 'true'
        if token == 'nil':
            return None
        if token.startswith('"'):
            return json.loads(token)
        if token.startswith("'"):
            raise ValueError('Single quoted Lua strings require a reviewed decoder')
        if re.fullmatch(r'-?\d+(?:\.\d+)?', token):
            return float(token) if '.' in token else int(token)
        raise ValueError(f'Unsupported literal {token!r}')

    def parse(self):
        self.pop('return')
        result = self.value()
        if self.pos != len(self.tokens):
            raise ValueError('Trailing code is not permitted')
        return result


def read_module(path):
    response = json.loads(Path(path).read_text(encoding='utf-8'))
    return LiteralLua(response['parse']['wikitext']['*']).parse()


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    for source in Path(sys.argv[1]).glob('*.json'):
        if source.name.endswith('.parsed.json'):
            continue
        value = read_module(source)
        dest = source.with_suffix('.parsed.json')
        dest.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
        print(source.name, len(value), list(value)[:12])
