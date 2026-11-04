#!/usr/bin/env node
// proteus-doctor: checks a computer for everything the Proteus video factory needs,
// and prints the exact command to fix each missing piece.
// Run: npx github:nam925/proteus-doctor   (options: --repo <path>, --json, --help, --version)
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const VERSION = require('../package.json').version;
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

if (flag('--help') || flag('-h')) {
  console.log(`proteus-doctor ${VERSION}
Checks this computer for the tools the Proteus factory needs and prints fixes.

Usage: npx github:nam925/proteus-doctor [--repo <path>] [--json]
  --repo <path>  Proteus folder (default: current folder if it is Proteus,
                 else ${WIN ? 'C:\\workspace\\claude-app\\proteus' : '~/proteus'})
  --json         Print results as JSON
Exit code: 0 when every required check passes, 1 otherwise.`);
  process.exit(0);
}
if (flag('--version') || flag('-v')) { console.log(VERSION); process.exit(0); }

// Run a command; never throws. shell:true lets Windows find .cmd/.bat tools.
function run(cmd, cmdArgs = [], cwd) {
  const r = spawnSync(cmd, cmdArgs, { cwd, shell: true, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return { ok: r.status === 0, out, first: out.split(/\r?\n/)[0] || '' };
}
const ver = (s) => (s.match(/\d+\.\d+(\.\d+)?/) || [''])[0];
const fix = (win, mac, linux) => (WIN ? win : MAC ? mac : linux);

function pickPython() {
  for (const c of WIN ? ['py -3', 'python', 'python3'] : ['python3', 'python']) {
    const r = run(c, ['--version']);
    // The Windows Store stub prints nothing useful and fails; real Python prints "Python 3.x".
    if (r.ok && /^Python 3\.\d+/.test(r.first)) return { cmd: c, version: ver(r.first) };
  }
  return null;
}

function findRepo() {
  const looks = (p) => p && fs.existsSync(path.join(p, 'CLAUDE.md')) &&
    /Proteus/.test(fs.readFileSync(path.join(p, 'CLAUDE.md'), 'utf8').slice(0, 300));
  const given = opt('--repo');
  if (given) return { path: path.resolve(given), found: looks(path.resolve(given)) };
  if (looks(process.cwd())) return { path: process.cwd(), found: true };
  const def = WIN ? 'C:\\workspace\\claude-app\\proteus' : path.join(os.homedir(), 'proteus');
  return { path: def, found: looks(def) };
}

const results = [];
function check(name, required, fn) {
  let r;
  try { r = fn(); } catch (e) { r = { ok: false, detail: String(e.message || e) }; }
  let detail = r.detail || '';
  // Shell "command not found" text (sh or Windows cmd) becomes a plain "not found".
  if (!r.ok && /not found|not recognized|cannot find/i.test(detail)) detail = 'not found';
  results.push({ name, required, ok: !!r.ok, detail, fix: r.ok ? '' : (r.fix || '') });
}

// ---- checks ----
check('Node.js 18+', true, () => {
  const major = +process.versions.node.split('.')[0];
  return { ok: major >= 18, detail: process.versions.node,
    fix: fix('winget install --id OpenJS.NodeJS.LTS -e', 'brew install node', 'sudo apt install -y nodejs npm') };
});

check('Git', true, () => {
  const r = run('git', ['--version']);
  return { ok: r.ok, detail: ver(r.first),
    fix: fix('winget install --id Git.Git -e', 'brew install git', 'sudo apt install -y git') };
});

const py = pickPython();
check('Python 3', true, () => ({ ok: !!py, detail: py ? `${py.version} (${py.cmd})` : 'not found',
  fix: fix('winget install --id Python.Python.3.13 -e   (then open a new terminal)', 'brew install python', 'sudo apt install -y python3 python3-pip') }));

check('ffmpeg', true, () => {
  const r = run('ffmpeg', ['-version']);
  return { ok: r.ok, detail: ver(r.first),
    fix: fix('winget install --id Gyan.FFmpeg -e   (then open a new terminal)', 'brew install ffmpeg', 'sudo apt install -y ffmpeg') };
});

check('Claude Code', true, () => {
  const r = run('claude', ['--version']);
  return { ok: r.ok, detail: ver(r.first), fix: 'npm install -g @anthropic-ai/claude-code' };
});

const pip = py ? `${py.cmd} -m pip install -U` : (WIN ? 'py -3 -m pip install -U' : 'python3 -m pip install -U');
check('yt-dlp (reference downloads)', true, () => {
  const r = run('yt-dlp', ['--version']);
  return { ok: r.ok, detail: r.first, fix: `${pip} yt-dlp` };
});

check('Graphify (code map)', false, () => {
  const r = run('graphify', ['--version']);
  return { ok: r.ok, detail: ver(r.first), fix: `${pip} graphifyy` };
});

const repo = findRepo();
check('Proteus repo', true, () => ({ ok: repo.found, detail: repo.path,
  fix: `git clone https://github.com/nam925/proteus "${repo.path}"` }));

if (repo.found) {
  check('Repo up to date', true, () => {
    run('git', ['fetch', '--quiet', 'origin'], repo.path);
    const r = run('git', ['status', '-sb'], repo.path);
    const behind = (r.first.match(/behind (\d+)/) || [])[1];
    return { ok: r.ok && !behind, detail: r.first,
      fix: `cd "${repo.path}" && git pull --rebase origin main` };
  });
  check('Graphify git hook', false, () => {
    const hook = path.join(repo.path, '.git', 'hooks', 'pre-commit');
    const ok = fs.existsSync(hook) && /graphify/.test(fs.readFileSync(hook, 'utf8'));
    return { ok, detail: ok ? 'installed' : 'missing', fix: `cd "${repo.path}" && bash tools/setup-pc.sh` };
  });
}

check('REA registered in Claude Code', false, () => {
  const r = run('claude', ['mcp', 'list']);
  const ok = r.ok && /\brea\b/i.test(r.out);
  return { ok, detail: ok ? 'found' : (r.ok ? 'not in claude mcp list' : 'could not run claude mcp list'),
    fix: 'npx rea-agents@latest setup   (pick Claude Code)' };
});

check('Caveman ultra config', false, () => {
  const p = path.join(os.homedir(), '.config', 'caveman', 'config.json');
  let ok = false, detail = 'missing';
  if (fs.existsSync(p)) { try { const c = JSON.parse(fs.readFileSync(p, 'utf8')); ok = /ultra/i.test(JSON.stringify(c)); detail = ok ? 'ultra' : 'not ultra'; } catch { detail = 'unreadable'; } }
  return { ok, detail, fix: 'See docs/todo.md step 1.6a in the Proteus repo' };
});

// ---- report ----
const failedRequired = results.filter((r) => r.required && !r.ok);
if (flag('--json')) {
  console.log(JSON.stringify({ version: VERSION, platform: process.platform, ok: failedRequired.length === 0, results }, null, 2));
} else {
  const tty = process.stdout.isTTY && !process.env.NO_COLOR;
  const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  console.log(`\nproteus-doctor ${VERSION} on ${os.hostname()} (${process.platform})\n`);
  const w = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const mark = r.ok ? c(32, 'OK  ') : r.required ? c(31, 'FIX ') : c(33, 'OPT ');
    console.log(`${mark} ${r.name.padEnd(w)}  ${r.detail}`);
  }
  const todo = results.filter((r) => !r.ok);
  if (todo.length) {
    console.log(`\nTo fix, run these in order${WIN ? ' (PowerShell or Git Bash)' : ''}:`);
    todo.forEach((r, i) => console.log(`  ${i + 1}. ${r.name}${r.required ? '' : ' (optional)'}\n     ${r.fix}`));
    console.log('\nThen run this check again: npx github:nam925/proteus-doctor');
  }
  console.log(failedRequired.length ? c(31, `\n${failedRequired.length} required item(s) missing.`) : c(32, '\nAll required items present.'));
}
process.exit(failedRequired.length ? 1 : 0);
