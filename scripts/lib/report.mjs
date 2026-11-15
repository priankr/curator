export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Prints warnings to stdout and errors to stderr, each under a heading.
export function printIssues({ warnings, errors }) {
  if (warnings.length) {
    console.log('Warnings');
    for (const w of warnings) console.log(`  - ${w}`);
  }
  if (errors.length) {
    console.error('Errors');
    for (const e of errors) console.error(`  - ${e}`);
  }
}
