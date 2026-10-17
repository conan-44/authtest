# Third-party Dou Dizhu analysis engine

The following files are vendored from [justa-cai/doudizhu](https://github.com/justa-cai/doudizhu), commit `360b5708219561abfe66e68578d37ead848f0845`:

- `js/rules.js`
- `js/difficulty.js`
- `js/ai/engine.js`

They are used for optional in-browser move analysis and run in a Web Worker. The engine is a JavaScript heuristic engine, not a port of DouZero and not a probability model. It uses the player hand, public played-card counts, roles, and remaining hand sizes.

The upstream MIT license and copyright notice are included in `LICENSE`. The vendored source files retain their upstream headers. The surrounding game and the adapter are maintained separately.
