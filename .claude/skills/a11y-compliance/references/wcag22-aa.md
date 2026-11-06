# WCAG 2.2 Level A + AA checklist (= ISO/IEC 40500:2025)

Source: https://www.w3.org/TR/WCAG22/ . 4.1.1 Parsing is removed in 2.2. ★ = automation (axe) rarely catches it in this app; check by hand.

## 1 Perceivable
| SC | Name | Lv | What to check here |
|---|---|---|---|
| 1.1.1 | Non-text Content | A | SVG charts have a text alternative (accessible names on marks + V2/table equivalent); decorative SVG/emoji `aria-hidden="true"`; icon buttons have names |
| 1.2.1–1.2.3 | Prerecorded audio/video | A | N/A unless media is added |
| 1.2.4 / 1.2.5 | Captions (Live) / Audio description | AA | N/A unless media is added |
| 1.3.1 | Info and Relationships ★ | A | Headings, lists, tables with `<th>`, form labels, groups (`fieldset/legend`); 本人の表現 vs 解釈 distinguished in text |
| 1.3.2 | Meaningful Sequence | A | DOM order = reading order (V2 alternating cards stay chronological in DOM) |
| 1.3.3 | Sensory Characteristics | A | Instructions never rely only on shape/colour/position (「右の…」「青い…」) |
| 1.3.4 | Orientation | AA | Works in portrait and landscape (tablets) |
| 1.3.5 | Identify Input Purpose | AA | `autocomplete` for personal-data fields (none expected: research IDs only) |
| 1.4.1 | Use of Color ★ | A | Layer, status, candidate/adopted, mock badges carry text or shape too |
| 1.4.2 | Audio Control | A | Read-aloud (V3) can be stopped |
| 1.4.3 | Contrast (Minimum) | AA | Text 4.5:1, large text 3:1, both themes |
| 1.4.4 | Resize Text | AA | 200% zoom without loss |
| 1.4.5 | Images of Text | AA | No text baked into images |
| 1.4.10 | Reflow ★ | AA | 320 CSS px: no 2-D scroll except charts/tables (allowed exception) |
| 1.4.11 | Non-text Contrast ★ | AA | Chart marks, focus rings, input borders 3:1 against neighbours |
| 1.4.12 | Text Spacing | AA | No clipping with line-height 1.5 / letter 0.12em / word 0.16em / paragraph 2em |
| 1.4.13 | Content on Hover or Focus ★ | AA | Tooltips: dismissible (Esc), hoverable, persistent |

## 2 Operable
| SC | Name | Lv | What to check here |
|---|---|---|---|
| 2.1.1 | Keyboard ★ | A | Every function (chart marks, drawer, card toggles, brush alternative, reactions) works by keyboard |
| 2.1.2 | No Keyboard Trap | A | Drawer/modal can be left with Esc/Tab |
| 2.1.4 | Character Key Shortcuts | A | No single-key shortcuts, or they can be turned off |
| 2.2.1 | Timing Adjustable ★ | A | No auto-dismiss of messages that need reading; no session timeouts |
| 2.2.2 | Pause, Stop, Hide | A | No auto-moving content; smooth scroll respects `prefers-reduced-motion` |
| 2.3.1 | Three Flashes | A | No flashing |
| 2.4.1 | Bypass Blocks | A | Skip link to `<main>` |
| 2.4.2 | Page Titled | A | Unique `document.title` per route |
| 2.4.3 | Focus Order ★ | A | Logical; focus moves into opened drawer, returns after close |
| 2.4.4 | Link Purpose (In Context) | A | Chip/link text identifies target (e.g. 「原記録 10-08」) |
| 2.4.5 | Multiple Ways | AA | Breadcrumbs + dashboard links + V1/V2 cross links |
| 2.4.6 | Headings and Labels | AA | Descriptive headings; one `<h1>` per route |
| 2.4.7 | Focus Visible ★ | AA | Visible `:focus-visible` style on every control incl. SVG marks |
| 2.4.11 | Focus Not Obscured (Minimum) ★ | AA | Sticky header/side panel/drawer never fully cover the focused element (`scroll-margin`) |
| 2.5.1 | Pointer Gestures | A | No path/multipoint gestures required |
| 2.5.2 | Pointer Cancellation | A | Actions fire on click/up, not down (V1 brush starts on down: must be cancellable, with alternative) |
| 2.5.3 | Label in Name | A | Accessible name contains visible label |
| 2.5.4 | Motion Actuation | A | N/A |
| 2.5.7 | Dragging Movements ★ | AA | V1 brush and mini drag have single-pointer alternatives |
| 2.5.8 | Target Size (Minimum) ★ | AA | ≥ 24×24 px or spacing exception; chart marks need hit areas ≥ 24 px |

## 3 Understandable
| SC | Name | Lv | What to check here |
|---|---|---|---|
| 3.1.1 | Language of Page | A | `<html lang="ja">` |
| 3.1.2 | Language of Parts | AA | `lang="en"` on English phrases if any |
| 3.2.1 | On Focus | A | Focus never triggers navigation |
| 3.2.2 | On Input | A | Changing a select only filters/highlights in place (announce change); no unexpected navigation |
| 3.2.3 | Consistent Navigation | AA | Header/breadcrumb same place on all routes |
| 3.2.4 | Consistent Identification | AA | Same function = same label (「大切だと思う」「詳しく」…) |
| 3.2.6 | Consistent Help | A | If help exists (V3「てつだって」, legend), same relative place on each screen |
| 3.3.1 | Error Identification | A | Form errors described in text |
| 3.3.2 | Labels or Instructions | A | Every input has a visible label |
| 3.3.3 | Error Suggestion | AA | Suggest the fix |
| 3.3.4 | Error Prevention (Legal, Financial, Data) | AA | Deleting/overwriting records is reversible or confirmed |
| 3.3.7 | Redundant Entry | A | Meeting forms prefill known info (meeting ID, scene, participants) |
| 3.3.8 | Accessible Authentication (Minimum) | AA | When login is added: no cognitive test; allow password managers/passkeys |

## 4 Robust
| SC | Name | Lv | What to check here |
|---|---|---|---|
| 4.1.2 | Name, Role, Value ★ | A | Custom controls expose role/state (`aria-pressed`, `aria-expanded`, `aria-current`) |
| 4.1.3 | Status Messages ★ | AA | Save/add/stop feedback via `role="status"` live region |
