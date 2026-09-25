# No Deceit has moved off npm

This package (`no-deceit@0.7.2`) is a tombstone. It contains no code.

No Deceit is now installed as a **git checkout** (a "home" repo) and updated
with `git pull` / `nd update`:

```bash
git clone https://github.com/PDepaula/no-deceit
cd no-deceit
bin/nd bootstrap
```

Full instructions, including how to uninstall a Claude Code marketplace copy
and how to point OpenCode, Pi and Cursor at the checkout, are in the
[README](https://github.com/PDepaula/no-deceit#readme).

Versions `<=0.7.2` are deprecated and unmaintained. OpenCode users who ran
`opencode plugin no-deceit`: remove that entry from your OpenCode config and
use `nd bootstrap --opencode` instead.
