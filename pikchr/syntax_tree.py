#!/usr/bin/env python3
import re
from collections import defaultdict
import graphviz
from argparse import ArgumentParser


def parse(filename: str):
    with open(filename) as f:
        code = f.read()
        no_paren = re.compile(r"\(.+\)", re.MULTILINE | re.DOTALL)
        spaces = re.compile(r"\s+", re.MULTILINE | re.DOTALL)
        for left, right in re.findall(
            r"^\s*(\S+)\s*::=(.*?)\.", code, re.MULTILINE | re.DOTALL
        ):
            left = no_paren.sub("", left)
            right = [
                no_paren.sub("", item) for item in spaces.split(right.strip())
            ]
            yield left, right


subgraphs = (
    "basetype",
    "between",
    "boolproperty",
    "colorproperty",
    "dashproperty",
    "direction",
    "edge",
    "even",
    "lvalue",
    "numproperty",
    "print",
    "pritem",
    "prsep",
    "rvalue",
    "savelist",
    # "unnamed_statement",
    "withclause",
    "optrelexpr",
    # "objectname", recursion
)

dbg_count = 0


def render(
    dot: graphviz.Digraph,
    dot_key: str,
    items: list[str],
    dd: dict[str, list[list[str]]],
):
    global dbg_count
    prev = dot_key
    replace = {
        "EOL": r"\\n|;",
        "": r"\<empty string\>",
        "EDGEPT": "bot|c|e|east|n|ne|north|nw|s|se|south|sw|w|west",
        "LAST": "last|previous",
        "PERCENT": "%",
        "LP": "(",
        "RP": ")",
        "LB": "[",
        "RB": "]",
        "COMMA": ",",
        "COLON": ":",
        "GT": ">",
        "LT": "<",
        "EQ": "=",
        "PLUS": "+",
        "MINUS": "-",
        "LRARROW": "\\<-\\>",
        "LARROW": "\\<-",
        "RARROW": "-\\>",
        "PLACENAME": "PLACENAME ([A-Z]+)",
        "CLASSNAME": "arc|arrow|box|circle|cylinder|dot|ellipse|file|line|move|oval|spline|text",
        "even": r"UNTIL EVEN WITH|EVEN WITH",
    }
    for orig_value in items:
        dbg_count += 1
        dot2_key = f"{orig_value}_{dot_key}_{dbg_count}"
        value = replace.get(orig_value, orig_value)
        if value in subgraphs:
            dot2_key = f"{value}_{dot_key}_{dbg_count}"
            with dot.subgraph(
                name=dot2_key,
                comment=value,
                node_attr={"shape": "box", "color": "green", "label": value},
            ) as c:
                for item in dd[value]:
                    render(c, dot2_key, item, dd)
        else:
            if value.isupper() or orig_value in replace:
                color = "red"
            else:
                color = "blue"
            dot.node(dot2_key, value, color=color)
        dot.edge(prev, dot2_key)
        prev = dot2_key


def main():
    parser = ArgumentParser()
    parser.add_argument("pikchr_y_path")
    pikchr_y_path = parser.parse_args().pikchr_y_path
    dot = graphviz.Digraph("round-table", comment="Pikchr")
    dd = defaultdict[str, list[list[str]]](list)
    for left, right in parse(pikchr_y_path):
        dd[left].append(right)

    for idx, (key, items) in enumerate(dd.items()):
        if key in subgraphs:
            continue
        dot_key = f"{key}_{idx}"
        dot.node(dot_key, key)
        for item in items:
            render(dot, dot_key, item, dd)

    dot.render(directory="doctest-output", view=True)


if __name__ == "__main__":
    main()
