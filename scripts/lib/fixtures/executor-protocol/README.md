# Executor vocabulary regression fixture

`work-cycle-before-1504.md` is the unmodified output of:

```sh
git show f0b074d303e6241f2cceba3d9fd4e7ba81da11d9:scripts/harness-template/skills/pfd-ops/references/work-cycle.md
```

This is the version after the work-item location contract and before protocol cleanup for issue 1504.
It is stored so shallow CI checkouts can test the historical negative case without fetching history.
The positive case reads the current canonical work-cycle document.
