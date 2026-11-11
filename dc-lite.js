/* dc-lite: renders the design-canvas screen files (screens/*.dc.html) in a normal browser with React.
   Supports the subset the screens use: {{holes}}, <sc-for>, <sc-if>, <dc-import>, event handlers,
   refs, controlled inputs, and links between screens. */
(function () {
  const h = React.createElement;
  const registry = {};      // name -> component class
  const injected = new Set();
  const ATTR = { class: 'className', for: 'htmlFor', tabindex: 'tabIndex', readonly: 'readOnly', maxlength: 'maxLength',
    viewbox: 'viewBox', onclick: 'onClick', onchange: 'onChange', oninput: 'onInput', onkeydown: 'onKeyDown' };
  const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

  function lookup(scope, path) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
  }
  function value(raw, scope) {
    const whole = raw.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
    if (whole) return lookup(scope, whole[1]);
    return raw.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, p) => { const v = lookup(scope, p); return v == null ? '' : v; });
  }
  function styleObj(str) {
    const out = {};
    str.split(';').forEach((decl) => {
      const i = decl.indexOf(':');
      if (i < 0) return;
      const k = decl.slice(0, i).trim(), v = decl.slice(i + 1).trim();
      if (k) out[k.startsWith('--') ? k : camel(k)] = v;
    });
    return out;
  }

  function render(node, scope, key) {
    if (node.nodeType === 3) {
      const t = node.nodeValue;
      if (!t.trim() && t.includes('\n')) return null;
      return t.includes('{{') ? String(value(t, scope)) : t;
    }
    if (node.nodeType !== 1) return null;
    const tag = node.tagName.toLowerCase();
    const kids = (sc) => Array.from(node.childNodes).map((c, i) => render(c, sc, i)).filter((x) => x !== null);
    if (tag === 'helmet') return null;
    if (tag === 'sc-if') return value(node.getAttribute('value') || '', scope) ? h(React.Fragment, { key }, ...kids(scope)) : null;
    if (tag === 'sc-for') {
      const list = value(node.getAttribute('list') || '', scope) || [];
      const as = node.getAttribute('as') || 'item';
      return h(React.Fragment, { key }, ...list.map((item, i) =>
        h(React.Fragment, { key: i }, ...kids(Object.assign({}, scope, { [as]: item, $index: i })))));
    }
    if (tag === 'dc-import') {
      const props = { key };
      for (const a of node.attributes) {
        if (a.name === 'name' || a.name.startsWith('hint-')) continue;
        props[camel(a.name)] = value(a.value, scope);
      }
      const C = registry[node.getAttribute('name')];
      return C ? h(C, props) : null;
    }
    const props = { key };
    for (const a of node.attributes) {
      let name = ATTR[a.name] || a.name;
      if (!name.startsWith('aria-') && !name.startsWith('data-') && name.includes('-')) name = camel(name);
      const v = value(a.value, scope);
      if (name === 'style') props.style = styleObj(String(v));
      else props[name] = v;
    }
    if (tag === 'a' && typeof props.href === 'string' && props.href.endsWith('.dc.html')) {
      const target = props.href.replace(/^.*\//, '').replace('.dc.html', '');
      props.href = '#' + target;
      const own = props.onClick;
      props.onClick = (e) => { e.preventDefault(); if (typeof own === 'function') own(e); window.dcNavigate(target); };
    }
    if ((tag === 'input' || tag === 'textarea') && 'value' in props && !props.onChange) props.readOnly = true;
    const children = kids(scope);
    return h(tag, props, ...(children.length ? children : []));
  }

  class DCLogic extends React.Component {
    constructor(p) { super(p); this.state = {}; }
    render() {
      const tpl = this.constructor.__tpl;
      const vals = this.renderVals ? this.renderVals() : {};
      return h(React.Fragment, null, ...Array.from(tpl.childNodes).map((c, i) => render(c, vals, i)).filter((x) => x !== null));
    }
  }

  async function load(name) {
    const text = await (await fetch('screens/' + name + '.dc.html?v=' + (window.DC_VERSION || '1'))).text();
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const xdc = doc.querySelector('x-dc');
    const helmet = xdc.querySelector('helmet');
    if (helmet && !injected.has(name)) {
      injected.add(name);
      helmet.querySelectorAll('link').forEach((l) => { if (!document.querySelector(`link[href="${l.href}"]`)) document.head.appendChild(l.cloneNode()); });
      helmet.querySelectorAll('style').forEach((s) => { const el = document.createElement('style'); el.textContent = s.textContent.replace(/body\{[^}]*\}/, ''); document.head.appendChild(el); });
    }
    const src = doc.querySelector('script[data-dc-script]').textContent;
    const Cls = new Function('DCLogic', src + '\nreturn Component;')(DCLogic);
    Cls.__tpl = xdc;
    Cls.displayName = name;
    registry[name] = Cls;
    return Cls;
  }

  window.dcLite = { load, registry };
})();
