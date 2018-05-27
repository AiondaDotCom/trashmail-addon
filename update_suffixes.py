#!/usr/bin/env python3

"""
Running this script will update the public suffix data used to tie addresses
to organisational domains (and not sub-domains).

Due to the fact that an out-of-date list slowly causes minor degradation of the
user experience, and that when updated again it will resolve the issues on the
next sync, it is reasonable to only update this data every few months or every year.

To update the data, simply run this script and commit the updated file.
"""

import encodings.idna
import json
import urllib.request
from pathlib import Path

SUFFIX_URL = "https://publicsuffix.org/list/public_suffix_list.dat"

def parse(f):
    rules = {}
    exceptions = {}

    for line in f.readlines():
        line = line.decode().split("//", 1)[0].strip().lower()
        if not line:
            continue

        store = exceptions if line.startswith("!") else rules
        line = line.lstrip("!")
        line = b".".join(encodings.idna.ToASCII(x) for x in line.split("."))
        line = line.decode()

        try:
            line, tld = line.rsplit(".", 1)
        except ValueError:
            tld = line
            line = ""

        if tld not in store:
            store[tld] = []

        if line:
            store[tld].append(line)

    for store in (rules, exceptions):
        for tld in store:
            suffixes = " ".join(store[tld])
            if not suffixes:
                store[tld] = ""
            elif len(suffixes) < 480:
                store[tld] = " {} ".format(suffixes)
            else:
                suffixes = {}
                for suffix in store[tld]:
                    l = len(suffix)
                    try:
                        suffixes[l].append(suffix)
                    except KeyError:
                        suffixes[l] = [suffix]

                for k, v in suffixes.items():
                    suffixes[k] = "".join(sorted(v))

                store[tld] = suffixes

    return rules, exceptions

if __name__ == "__main__":
    output = Path(__file__).with_name("public_suffix.json")
    suffix_data = urllib.request.urlopen(SUFFIX_URL)
    json.dump(parse(suffix_data), output.open("w"))
