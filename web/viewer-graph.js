// フローマップのアイコン、配置、コメント、拡大・縮小。

function joinRegions(type) {
  return {
    left: ['left', 'full', 'leftOnly', 'notInner'].includes(type),
    right: ['right', 'full', 'rightOnly', 'notInner'].includes(type),
    overlap: ['inner', 'left', 'right', 'full'].includes(type),
  };
}

function nodeJoinType(node) {
  return (
    node.raw?.actionNode?.joinType ||
    node.raw?.joinType ||
    node.actions?.find((a) => a.type === 'SimpleJoin')?.raw?.joinType ||
    ''
  );
}

function icon(kind, color = '#499893', attributes = '', pivotDirection = 'unpivot', joinType = '') {
  const wrap = (shape) =>
    `<svg viewBox="0 0 32 32" ${attributes} aria-hidden="true">${shape}</svg>`;
  const file =
    '<path d="M11 8h7l5 5v12H11z M18 8v6h5 M14 18h6 M14 21h6" fill="none" stroke="white" stroke-width="1.3" stroke-linejoin="round"/>';
  if (kind === 'input') return wrap(`<circle cx="16" cy="16" r="14" fill="${color}"/>${file}`);
  if (kind === 'output')
    return wrap(`<rect x="3" y="3" width="26" height="26" rx="2" fill="#697782"/>${file}`);
  if (kind === 'clean')
    return wrap(
      `<path d="M4 19h24" stroke="${color}" stroke-width="6" stroke-linecap="round"/><path d="M12 7h8M14 10h4" stroke="#87969d" stroke-width="1.5" stroke-linecap="round"/>`,
    );
  if (kind === 'join') {
    const regions = joinRegions(joinType),
      fill = (part) => (regions[part] ? color : 'white');
    return wrap(
      `<circle data-join-region="left" cx="12" cy="16" r="9" fill="${fill('left')}"/><circle data-join-region="right" cx="21" cy="16" r="9" fill="${fill('right')}"/><path data-join-region="overlap" d="M16.5 8.206 A9 9 0 0 1 16.5 23.794 A9 9 0 0 1 16.5 8.206Z" fill="${fill('overlap')}"/><circle cx="12" cy="16" r="9" fill="none" stroke="#77858e" stroke-width="1.2"/><circle cx="21" cy="16" r="9" fill="none" stroke="#77858e" stroke-width="1.2"/>`,
    );
  }
  if (kind === 'union')
    return wrap(
      `<path d="M3 5h18v7H3zM12 12h18v7H12zM3 19h18v7H3z" fill="${color}" stroke="#8f8a65" stroke-width=".8"/>`,
    );
  if (kind === 'aggregate')
    return wrap(
      `<path d="M25 5H9l10 11L9 27h16" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>`,
    );
  if (kind === 'pivot')
    return `<svg viewBox="0 0 42 27" ${attributes} aria-hidden="true">${PREP_ICONS.steps[pivotDirection].map((p) => `<path d="${p.d}" fill="${p.fill || color}"${p.transform ? ` transform="${p.transform}"` : ''}/>`).join('')}</svg>`;
  return wrap(
    `<rect x="5" y="5" width="22" height="22" rx="5" fill="${color}"/><text x="16" y="22" text-anchor="middle" fill="white" font-size="18">?</text>`,
  );
}

function pivotDirection(n) {
  return /unpivot/i.test(n.raw?.actionNode?.nodeType || n.nodeType || '') ? 'unpivot' : 'pivot';
}

// Tableau flow annotations are distinct operation categories, not formula counts.
const ANNOTATIONS = uiLabels([
  {
    key: 'calculate',
    label: '計算フィールド',
    types: [
      'AddColumn',
      'QuickCalcColumn',
      'QuickDateNameCalcColumn',
      'DuplicateColumn',
      'MultiRowCalc',
    ],
  },
  {
    key: 'filter',
    label: 'フィルター',
    types: [
      'Filter',
      'FilterOperation',
      'RangeFilter',
      'ValueFilter',
      'RichNullFilter',
      'RichWildcardFilter',
      'UniquenessFilter',
    ],
  },
  {
    key: 'remove',
    label: 'フィールドを削除',
    types: ['RemoveColumns', 'RemoveColumn', 'KeepOnlyColumns'],
  },
  { key: 'group', label: '値のグループ化・置換', types: ['Remap', 'MergeColumns'] },
  { key: 'rename', label: 'フィールド名を変更', types: ['RenameColumn', 'BulkRenameColumns'] },
  { key: 'type', label: 'データ型を変更', types: ['ChangeColumnType'] },
]);

function annotationIcons(n) {
  const items = ANNOTATIONS.filter((spec) => n.actions.some((a) => spec.types.includes(a.type)));
  return `<g class="flow-annotations" data-count="${items.length}">${items.map((spec, i) => `<g class="flow-annotation" data-kind="${spec.key}" aria-label="${esc(spec.label)}" transform="translate(${i * 16} 0)"><image href="${PREP_ICONS.annotations[spec.key]}" width="13" height="13"/></g>`).join('')}</g>`;
}

function renderGraph() {
  commentMeasure.font = `${commentFont}px "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif`;
  const commentTop = 140,
    commentLineHeight = Math.ceil(commentFont * 1.25);
  const layout = commentLayout(
    DATA.nodes,
    expandedComments,
    (text) => commentMeasure.measureText(text).width,
    { top: commentTop, lineHeight: commentLineHeight },
  );
  positions = layout.positions;
  bounds = layout.bounds;
  $('edges').innerHTML = DATA.edges
    .map((e, i) => {
      const a = positions.get(e.source),
        b = positions.get(e.target),
        source = byId.get(e.source),
        target = byId.get(e.target);
      const edgeGap = (kind) => graphEdgeOffset(kind, graphTextSizes(scale, commentFont).icon);
      const x1 = a.x + edgeGap(source.kind),
        x2 = b.x - edgeGap(target.kind);
      const bend = Math.max(45, Math.abs(x2 - x1) * 0.48);
      return `<path class="flow-edge" data-edge="${i}" d="M${x1} ${a.y} C${x1 + bend} ${a.y},${x2 - bend} ${b.y},${x2} ${b.y}" marker-end="url(#arrow)"/>`;
    })
    .join('');
  $('nodes').innerHTML = DATA.nodes
    .map((n) => {
      const p = positions.get(n.id),
        label = wrapLabel(n.name, 14);
      const iconBounds =
        n.kind === 'pivot'
          ? 'x="-28.11375" y="-18.7425" width="56.2275" height="37.485"'
          : n.kind === 'join'
            ? 'x="-24.255" y="-24.255" width="48.51" height="48.51"'
            : 'x="-19.845" y="-19.845" width="39.69" height="39.69"';
      const symbol =
        n.kind === 'clean'
          ? `<path d="M-44.1 0h88.2" stroke="${n.color}" stroke-width="8.93025" stroke-linecap="round"/>`
          : icon(n.kind, n.color, iconBounds, pivotDirection(n), nodeJoinType(n)).replace(
              '<svg ',
              '<svg overflow="visible" ',
            );
      return `<g class="flow-node" data-id="${esc(n.id)}" transform="translate(${p.x} ${p.y})" tabindex="0" role="button" aria-label="${esc(n.name + ', ' + ui(n.kindLabel))}"><rect class="node-backdrop" x="-75" y="-42" width="150" height="106" rx="7"/><g class="step-symbol">${symbol}</g>${annotationIcons(n)}<text class="node-name" text-anchor="middle" y="30">${label.map((line, i) => `<tspan x="0" dy="${i ? 16 : 0}">${esc(line)}</tspan>`).join('')}</text></g>`;
    })
    .join('');
  $('step-comments').innerHTML = DATA.nodes
    .filter((n) => n.description?.trim())
    .map((n) => {
      const p = positions.get(n.id),
        comment = layout.comments.get(n.id),
        open = expandedComments.has(n.id);
      return `<g transform="translate(${p.x} ${p.y})"><g class="comment-toggle ${open ? 'expanded' : ''}" data-comment-toggle="${esc(n.id)}" role="button" tabindex="0" aria-label="${esc(n.name + ui('のコメントを') + (open ? ui('非表示') : ui('表示')))}" aria-expanded="${open}" aria-controls="comment-${esc(n.id)}" transform="translate(56 23)"><rect x="-3" y="-3" width="23" height="23" rx="3"/><path d="M2 2h12v9H8l-4 4v-4H2Z"/></g><text id="comment-${esc(n.id)}" class="step-comment" style="font-size:${commentFont}px" x="-70" y="${commentTop}" ${open ? '' : 'display="none"'}>${comment ? comment.lines.map((line, i) => `<tspan x="-70" dy="${i ? commentLineHeight : 0}">${esc(line) || '&#8203;'}</tspan>`).join('') : ''}</text></g>`;
    })
    .join('');
  highlightGraph();
}

function toggleStepComment(id) {
  const before = positions.get(id);
  if (!before) return;
  if (expandedComments.has(id)) expandedComments.delete(id);
  else expandedComments.add(id);
  renderGraph();
  const after = positions.get(id);
  offset.x += (before.x - after.x) * scale;
  offset.y += (before.y - after.y) * scale;
  applyTransform();
  [...document.querySelectorAll('[data-comment-toggle]')]
    .find((b) => b.dataset.commentToggle === id)
    ?.focus({ preventScroll: true });
}

function wrapLabel(name, max) {
  const s = Array.from(name);
  return s.length > max
    ? [
        s.slice(0, max).join(''),
        s.slice(max, max * 2 - 1).join('') + (s.length > max * 2 - 1 ? '…' : ''),
      ]
    : [name];
}

function highlightGraph() {
  const related = new Set();
  function trace(id, dir) {
    const queue = [id],
      seen = new Set();
    while (queue.length) {
      const k = queue.pop();
      if (seen.has(k)) continue;
      seen.add(k);
      for (const next of byId.get(k)?.[dir] || []) {
        related.add(next);
        queue.push(next);
      }
    }
  }
  if (selected) {
    related.add(selected);
    trace(selected, 'upstream');
    trace(selected, 'downstream');
  }
  document.querySelectorAll('.flow-node').forEach((g) => {
    g.classList.toggle('selected', g.dataset.id === selected);
    g.setAttribute('aria-pressed', String(g.dataset.id === selected));
  });
  document.querySelectorAll('.flow-edge').forEach((g) => {
    const e = DATA.edges[Number(g.dataset.edge)];
    g.classList.toggle('related', !!selected && related.has(e.source) && related.has(e.target));
  });
}

function graphTextSizes(zoom, layoutCommentFont) {
  // Keep the current icon scaling; give captions independent minimum screen sizes.
  const icon = Math.max(1, Math.min(1.8, 0.9 / zoom)),
    title = Math.max(13 * icon, 14 / zoom);
  return {
    icon,
    title,
    comment: Math.max(
      13 / zoom,
      Math.min(layoutCommentFont, title * 0.924, Math.max(12.6, 9.45 / zoom)),
    ),
  };
}

function graphEdgeOffset(kind, magnify) {
  const half =
    kind === 'clean' ? 48.565125 : kind === 'join' ? 24.255 : kind === 'pivot' ? 28.11375 : 19.845;
  return kind === 'clean' ? 56.715125 : half * magnify + 7;
}

function applyTransform() {
  $('viewport').setAttribute('transform', `translate(${offset.x} ${offset.y}) scale(${scale})`);
  const sizes = graphTextSizes(scale, commentFont),
    font = sizes.title;
  const titleY = 32.255 * sizes.icon + font * 0.8,
    titleBottoms = new Map(),
    commentObstacles = [],
    edgeSegments = [];
  document.querySelectorAll('.flow-node').forEach((g) => {
    const n = byId.get(g.dataset.id),
      area = graphTextArea(n.id, positions, scale),
      label = g.querySelector('.node-name');
    commentMeasure.font = `${font}px "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif`;
    const limit = Math.max(0, Math.min(2, Math.floor((area.bottom - titleY) / (font + 2)) + 1));
    const lines = fitGraphText(
      n.name,
      (text) => commentMeasure.measureText(text).width,
      area.width,
      limit,
    );
    label.style.fontSize = font + 'px';
    label.innerHTML = lines
      .map((line, i) => `<tspan x="0" dy="${i ? font + 2 : 0}">${esc(line)}</tspan>`)
      .join('');
    const oldTitle = g.querySelector(':scope > title');
    if (oldTitle) oldTitle.remove();
    if (lines.join('') !== n.name.replace(/\r?\n/g, '')) {
      const tooltip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      tooltip.textContent = n.name;
      g.insertBefore(tooltip, g.firstChild);
    }
    label.setAttribute('y', titleY);
    titleBottoms.set(n.id, titleY + Math.max(0, lines.length - 1) * (font + 2));
    g.querySelector('.step-symbol').setAttribute(
      'transform',
      `scale(${n.kind === 'clean' ? 1 : sizes.icon} ${sizes.icon})`,
    );
    g.querySelector('.node-backdrop').setAttribute(
      'height',
      Math.max(106, titleY + (lines.length - 1) * (font + 2) + 10 + 42),
    );
    const annotations = g.querySelector('.flow-annotations'),
      count = Number(annotations.dataset.count);
    // Keep processing glyphs at least 16 screen pixels when fitting a large flow.
    const magnify = Math.max(1, 16 / (13 * scale)),
      width = Math.max(0, count * 16 - 3) * magnify;
    const x = n.kind === 'input' ? -(19.845 * sizes.icon + 3) - width : -width / 2;
    const y =
      n.kind === 'input'
        ? -6.5 * magnify
        : -(n.kind === 'clean' ? 8.415125 : 24.255) * sizes.icon - 13 * magnify;
    annotations.setAttribute('transform', `translate(${x} ${y}) scale(${magnify})`);
    const p = positions.get(n.id);
    const obstacle = (left, top, right, bottom) =>
      commentObstacles.push({
        id: n.id,
        left: p.x + left,
        top: p.y + top,
        right: p.x + right,
        bottom: p.y + bottom,
      });
    const halfWidth =
      n.kind === 'clean'
        ? 48.565125
        : (n.kind === 'pivot' ? 28.11375 : n.kind === 'join' ? 24.255 : 19.845) * sizes.icon;
    const halfHeight =
      (n.kind === 'clean'
        ? 4.465125
        : n.kind === 'pivot'
          ? 18.7425
          : n.kind === 'join'
            ? 24.255
            : 19.845) * sizes.icon;
    obstacle(-halfWidth, -halfHeight, halfWidth, halfHeight);
    if (count) obstacle(x, y, x + width, y + 13 * magnify);
    if (lines.length) {
      const titleWidth = Math.max(...lines.map((line) => commentMeasure.measureText(line).width));
      obstacle(
        -titleWidth / 2,
        titleY - font,
        titleWidth / 2,
        titleBottoms.get(n.id) + font * 0.25,
      );
    }
    if (n.description?.trim()) {
      const toggleScale = Math.max(1, 0.85 / scale);
      obstacle(
        65 - 3 * toggleScale,
        titleY - font - 3 * toggleScale,
        65 + 20 * toggleScale,
        titleY - font + 20 * toggleScale,
      );
    }
  });
  document.querySelectorAll('.flow-edge').forEach((path) => {
    const e = DATA.edges[Number(path.dataset.edge)],
      a = positions.get(e.source),
      b = positions.get(e.target);
    const x1 = a.x + graphEdgeOffset(byId.get(e.source).kind, sizes.icon),
      x2 = b.x - graphEdgeOffset(byId.get(e.target).kind, sizes.icon);
    const bend = Math.max(45, Math.abs(x2 - x1) * 0.48);
    path.setAttribute('d', `M${x1} ${a.y} C${x1 + bend} ${a.y},${x2 - bend} ${b.y},${x2} ${b.y}`);
    edgeSegments.push(...graphCurveSegments(x1, a.y, x2, b.y, bend, 0.5 / scale));
  });
  document.querySelectorAll('.comment-toggle').forEach((g) => {
    g.setAttribute(
      'transform',
      `translate(65 ${titleY - font}) scale(${Math.max(1, 0.85 / scale)})`,
    );
    g.querySelector(':scope > title')?.remove();
  });
  // Allow ten extra lines below the map without changing layout or fit bounds.
  commentMeasure.font = `${sizes.comment}px "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif`;
  const commentPlacements = [],
    commentRects = new Map();
  const measureComment = (text) => commentMeasure.measureText(text).width;
  const reserveComment = (id, x, lines, geometry) =>
    commentRects.set(
      id,
      lines.map((line, i) => ({
        left: x,
        right: x + measureComment(line),
        top: geometry.y + i * geometry.lineHeight - geometry.fontSize,
        bottom: geometry.y + i * geometry.lineHeight + geometry.fontSize * 0.25,
      })),
    );
  document.querySelectorAll('.step-comment').forEach((label) => {
    const node = byId.get(label.id.slice('comment-'.length));
    if (!node || !expandedComments.has(node.id)) return;
    const commentY =
      titleBottoms.get(node.id) + Math.max(10, 6 / scale) + 4 / scale + sizes.comment;
    label.style.fontSize = sizes.comment + 'px';
    label.setAttribute('y', commentY);
    const lineHeight = Math.ceil(sizes.comment * 1.25);
    const area = graphTextArea(node.id, positions, scale, bounds.height - 30 + 10 * lineHeight);
    const limit = Math.max(0, Math.floor((area.bottom - commentY) / lineHeight) + 1);
    const p = positions.get(node.id);
    const geometry = {
      x: p.x - area.width / 2,
      y: p.y + commentY,
      fontSize: sizes.comment,
      lineHeight,
      padding: 3 / scale,
      segments: edgeSegments,
      rectangles: commentObstacles.filter((r) => r.id !== node.id),
    };
    const lines = avoidGraphCommentOverlaps(
      node.description,
      measureComment,
      area.width,
      limit,
      geometry,
    );
    reserveComment(node.id, geometry.x, lines, geometry);
    commentPlacements.push({ label, node, p, area, limit, geometry, lines });
  });
  // Reserve existing captions before moving any hidden one into nearby free space.
  for (const { label, node, p, area, limit, geometry, lines: original } of commentPlacements) {
    const placed = original.length
      ? { x: geometry.x, lines: original }
      : placeGraphComment(
          node.description,
          measureComment,
          area.width,
          limit,
          {
            ...geometry,
            rectangles: [
              ...geometry.rectangles,
              ...[...commentRects].filter(([id]) => id !== node.id).flatMap(([, rects]) => rects),
            ],
          },
          Math.min(area.width * 0.25, 24 / scale),
          2 / scale,
        );
    const { lines } = placed,
      x = placed.x - p.x,
      lineHeight = geometry.lineHeight;
    reserveComment(node.id, placed.x, lines, geometry);
    label.setAttribute('x', x);
    const truncated = lines.join('') !== node.description.replace(/\r?\n/g, '');
    if (truncated) {
      const toggle = label.parentElement.querySelector('.comment-toggle');
      if (toggle) {
        const tooltip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        tooltip.textContent = node.description;
        toggle.insertBefore(tooltip, toggle.firstChild);
      }
    }
    label.innerHTML =
      (truncated ? `<title>${esc(node.description)}</title>` : '') +
      lines
        .map(
          (line, i) =>
            `<tspan x="${x}" dy="${i ? lineHeight : 0}">${esc(line) || '&#8203;'}</tspan>`,
        )
        .join('');
  }
}

function fit() {
  autoFit = true;
  const r = $('graph').getBoundingClientRect();
  if (!r.width || !r.height) return;
  const fitScale = () =>
    Math.max(0.08, Math.min(1.4, (r.width - 38) / bounds.width, (r.height - 44) / bounds.height));
  // Fit with a readable comment size; cap growth for very large flows.
  commentFont = 12.6;
  renderGraph();
  for (let i = 0; i < 3; i++) {
    scale = fitScale();
    const font = Math.min(23.1, Math.max(12.6, 9.45 / scale));
    if (Math.abs(font - commentFont) < 0.1) break;
    commentFont = font;
    renderGraph();
  }
  scale = fitScale();
  offset = {
    x: (r.width - bounds.width * scale) / 2,
    y: (r.height - bounds.height * scale) / 2 - 5,
  };
  applyTransform();
}

function zoom(factor, x, y) {
  autoFit = false;
  const r = $('graph').getBoundingClientRect();
  x ??= r.width / 2;
  y ??= r.height / 2;
  const next = Math.min(3, Math.max(0.08, scale * factor));
  offset.x = x - ((x - offset.x) * next) / scale;
  offset.y = y - ((y - offset.y) * next) / scale;
  scale = next;
  applyTransform();
}

function handleGraphClick(e) {
  if (dragState?.moved) return;
  const comment = e.target.closest('[data-comment-toggle]');
  if (comment) {
    toggleStepComment(comment.dataset.commentToggle);
    return;
  }
  const n = e.target.closest('[data-id]');
  if (n) selectNode(n.dataset.id === selected ? null : n.dataset.id);
  else if (!e.target.closest('.flow-edge,.step-comment')) selectNode(null);
}

function resizePanel(width) {
  const total = document.querySelector('.workspace').clientWidth;
  document.documentElement.style.setProperty(
    '--detail-width',
    Math.max(320, Math.min(total - 200, width)) + 'px',
  );
  if (autoFit) fit();
}
