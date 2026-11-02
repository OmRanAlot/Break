// PostToolUse hook: after a code file under android/ or components/ is
// written or edited, remind the model to keep docs/LOGGING.md in sync.
// Reads the hook payload JSON on stdin, emits additionalContext only when
// the touched file is a relevant source file. Silent otherwise.
let data = '';
process.stdin.on('data', chunk => {
  data += chunk;
});
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(data || '{}');
    const raw = (input.tool_input && input.tool_input.file_path) || '';
    const path = raw.replace(/\\/g, '/');
    // Match Java/JS/JSX/TS/TSX files under an android/ or components/ dir.
    const isRelevant = /\/(android|components)\/.*\.(java|jsx?|tsx?)$/.test(
      path,
    );
    if (!isRelevant) return;
    const out = {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          'LOGGING.md sync check: you just modified ' +
          path +
          '. If this change added, renamed, or removed any Log TAG, ' +
          'log message prefix (e.g. "[FOO]"), JS console prefix, special ' +
          'marker, or SharedPreferences key, update docs/LOGGING.md in the ' +
          'same turn so its tables/filters stay accurate. If nothing ' +
          'log-relevant changed, ignore this.',
      },
    };
    process.stdout.write(JSON.stringify(out));
  } catch (e) {
    // Never block a tool on a malformed payload — fail silent.
  }
});
