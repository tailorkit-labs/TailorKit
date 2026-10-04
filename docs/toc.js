// Mintlify loads custom scripts on every page. Reuse its heading depth and
// active-section attributes so scrolling and anchor navigation stay native.
(() => {
  const namespace = "http://www.w3.org/2000/svg";
  const indent = 12;
  let currentList;
  let frame;
  const resizeObserver = new ResizeObserver(schedule);

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(draw);
  }

  function draw() {
    frame = undefined;
    const list = document.querySelector("#table-of-contents .toc");
    if (list !== currentList) {
      resizeObserver.disconnect();
      currentList = list;
      if (list) resizeObserver.observe(list);
    }
    if (!list) return;

    const items = Array.from(list.querySelectorAll(".toc-item")).filter((item) =>
      item.querySelector(":scope > a"),
    );
    if (!items.length) {
      list.querySelector(".tailorkit-toc-rail")?.remove();
      list.removeAttribute("data-tailorkit-rail");
      return;
    }

    for (const item of items) {
      const depth = Math.max(0, Number(item.dataset.depth) || 0);
      item.style.setProperty("--tailorkit-toc-indent", depth * indent + "px");
    }
    list.setAttribute("data-tailorkit-rail", "");
    const bounds = list.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    const rows = items.map((item) => {
      // A parent li contains its nested list. Measure only the heading link,
      // otherwise its bottom extends past the children and the path doubles back.
      const rect = item.querySelector(":scope > a").getBoundingClientRect();
      return {
        x: 1 + Math.max(0, Number(item.dataset.depth) || 0) * indent,
        top: rect.top - bounds.top,
        bottom: rect.bottom - bounds.top,
        active: item.hasAttribute("data-active-deepest"),
      };
    });
    const existing = list.querySelector(".tailorkit-toc-rail");
    const svg = existing || document.createElementNS(namespace, "svg");
    svg.setAttribute("class", "tailorkit-toc-rail");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", Math.max(...rows.map((row) => row.x)) + 1);
    svg.setAttribute("height", bounds.height);

    let activeTop = 0;
    let activeBottom = bounds.height;
    let track = "M " + rows[0].x + " " + rows[0].top;
    rows.forEach((row, index) => {
      const previous = rows[index - 1];
      // Fit a 45-degree join between heading rows, including wrapped titles.
      const join = previous
        ? Math.min(Math.abs(row.x - previous.x), (row.bottom - row.top) / 2)
        : 0;
      if (previous) {
        track += " L " + previous.x + " " + row.top;
        track += " L " + row.x + " " + (row.top + join);
      }
      track += " L " + row.x + " " + row.bottom;
      if (row.active) {
        activeTop = row.top + join;
        activeBottom = bounds.height - row.bottom;
      }
    });
    // Keep both paths mounted. CSS moves a clipping window along a bright
    // copy of the full rail, including its angled joins.
    for (const className of ["tailorkit-toc-rail-track", "tailorkit-toc-rail-active"]) {
      let path = svg.querySelector("." + className);
      if (!path) {
        path = document.createElementNS(namespace, "path");
        path.setAttribute("class", className);
        svg.append(path);
      }
      path.setAttribute("d", track);
      if (className === "tailorkit-toc-rail-active") {
        path.style.clipPath = "inset(" + activeTop + "px 0px " + activeBottom + "px 0px) view-box";
      }
    }
    if (!existing) list.append(svg);
  }

  new MutationObserver((records) => {
    if (
      records.some((record) => {
        // Ignore our SVG writes to avoid a mutation/redraw loop.
        if (record.type === "attributes") {
          return record.target.matches("#table-of-contents .toc-item");
        }
        return Array.from(record.addedNodes)
          .concat(Array.from(record.removedNodes))
          .some((node) => node.nodeType === 1 && !node.matches(".tailorkit-toc-rail"));
      })
    )
      schedule();
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-active-deepest", "data-depth"],
  });
  window.addEventListener("resize", schedule, { passive: true });
  document.fonts?.ready.then(schedule);
  schedule();
})();
