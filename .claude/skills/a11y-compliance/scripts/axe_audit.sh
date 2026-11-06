#!/usr/bin/env bash
# Run axe-core (WCAG 2.0/2.1/2.2 A+AA rules) against prototype routes in headless Chrome.
# Usage: [THEME=light|dark] [DETAIL=1] [BUDGET=ms] [TIMEOUT=s] .claude/skills/a11y-compliance/scripts/axe_audit.sh ['#/route' ...]   (DETAIL=1 lists failing elements)
# Output: one line per violation: route | rule | impact | nodes | wcag tags | help
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
PROTO="$ROOT/prototype"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
AXE="https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js"
TMP="${TMPDIR:-/tmp}/axe_audit_$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

routes=("$@")
[ ${#routes[@]} -eq 0 ] && routes=('#/' '#/p/P001' '#/p/P001/d/questions' '#/p/P001/d/reflection' '#/p/P001/d/practice' '#/p/P001/d/awareness' '#/p/P001/d/next' '#/p/P001/v1' '#/p/P001/v2' '#/p/P001/v3' '#/p/P001/meeting')

# Copy index.html with absolute asset paths and the axe runner appended.
sed -e "s#src=\"data/seed.js\"#src=\"$PROTO/data/seed.js\"#" \
    -e "s#src=\"app.js\"#src=\"$PROTO/app.js\"#" \
    -e "s#href=\"style.css\"#href=\"$PROTO/style.css\"#" \
    "$PROTO/index.html" > "$TMP/page.html"
cat >> "$TMP/page.html" <<EOF
<script>${THEME:+document.documentElement.dataset.theme='$THEME';}</script>
<script src="$AXE"></script>
<script>
setTimeout(async () => {
  const pre = document.createElement('pre'); pre.id = 'axe-out';
  try {
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'] } });
    const detail = ${DETAIL:-0};
    pre.textContent = r.violations.map(v => [v.id, v.impact, v.nodes.length, v.tags.filter(t => /^wcag\d/.test(t)).join(','), v.help].join(' | ') +
      (detail ? '\n' + v.nodes.slice(0, 8).map(n => '      -> ' + n.target.join(' ') + ' :: ' + (n.any[0]?.message || n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 160)).join('\n') : '')).join('\n') || 'NO_VIOLATIONS';
  } catch (e) { pre.textContent = 'AXE_ERROR ' + e; }
  document.body.appendChild(pre);
}, 1200);
</script>
EOF

for r in "${routes[@]}"; do
  out=$(perl -e "alarm ${TIMEOUT:-120}; exec @ARGV" "$CHROME" --headless=new --disable-gpu --window-size=1400,1000 \
        --virtual-time-budget=${BUDGET:-6000} --dump-dom "file://$TMP/page.html$r" 2>/dev/null || true)
  res=$(printf '%s' "$out" | perl -0ne 'print $1 if /<pre id="axe-out">(.*?)<\/pre>/s' | sed 's/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g')
  [ -z "$res" ] && res="NO_RESULT (page did not finish; re-run)"
  while IFS= read -r line; do echo "$r | $line"; done <<< "$res"
done
