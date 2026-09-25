// Prints the move notice and exits 0. Deliberately does nothing else: no
// network, no file writes, no dependencies.
console.log(
  [
    '',
    'No Deceit has moved to a git-based install; this npm package is unmaintained.',
    '  git clone https://github.com/PDepaula/no-deceit && cd no-deceit && bin/nd bootstrap',
    'See https://github.com/PDepaula/no-deceit#readme',
    '',
  ].join('\n'),
);
