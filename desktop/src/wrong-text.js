const escape = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function validateWrongFormat(text, runs) {
  if (!Array.isArray(runs) || runs.some(run => !run || typeof run.text !== 'string' || !run.text ||
    (run.bold !== undefined && typeof run.bold !== 'boolean') ||
    (run.color !== undefined && !/^#[0-9a-f]{6}$/i.test(run.color))) ||
    runs.map(run => run.text).join('') !== text) throw new Error('错题文字格式记录无效');
}

export function wrongTextHTML(text, runs = [{ text }]) {
  return runs.map(run => `<span style="font-weight:${run.bold ? 700 : 400};color:${run.color ?? '#000000'}">${escape(run.text)}</span>`).join('');
}

// Store only text, bold and RGB color, never browser-generated HTML.
export function readWrongEditor(editor) {
  const runs = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.data) continue;
    const style = getComputedStyle(node.parentElement);
    const rgb = style.color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    const color = rgb ? '#' + rgb.slice(1).map(n => Number(n).toString(16).padStart(2, '0')).join('') : '#000000';
    const run = { text: node.data, ...(Number(style.fontWeight) >= 600 ? { bold: true } : {}), ...(color !== '#000000' ? { color } : {}) };
    const previous = runs.at(-1);
    if (previous && previous.bold === run.bold && previous.color === run.color) previous.text += run.text;
    else runs.push(run);
  }
  return { text: runs.map(run => run.text).join(''), runs };
}

export function setWrongText(state, id, text, runs = [{ text }]) {
  state.wrongQuestions[id] = text;
  if (runs.some(run => run.bold || (run.color && run.color !== '#000000'))) state.wrongQuestionFormats[id] = structuredClone(runs);
  else delete state.wrongQuestionFormats[id];
}
