# proteus-doctor

```
npx github:nam925/proteus-doctor
```

Checks this computer for everything the Proteus video factory needs (Node, Git, Python, ffmpeg, Claude Code, yt-dlp, the Proteus repo, Graphify, REA, caveman settings) and prints the exact command to fix each missing piece. Needs only Node.js 18 or newer. Nothing is installed or changed; it only reads.

Options: `--repo <path>` (Proteus folder), `--json` (machine-readable), `--help`, `--version`.
Exit code 0 when every required item is present, 1 otherwise.

Made with the `make-npx-tool` skill.
