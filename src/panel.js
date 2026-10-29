/*
 * The Desktop Objects side panel: a live preview of the object you are working on.
 * Shows its icon, name, tagline and colour, its closed and open art, and the files area
 * (look.itemsArea), which you can drag and resize to place it. Edits go straight into object.json.
 */
define(function (require, exports, module) {
    "use strict";

    const WorkspaceManager = brackets.getModule("view/WorkspaceManager"),
        MainViewManager = brackets.getModule("view/MainViewManager"),
        DocumentManager = brackets.getModule("document/DocumentManager"),
        ProjectManager = brackets.getModule("project/ProjectManager"),
        FileSystem = brackets.getModule("filesystem/FileSystem"),
        CommandManager = brackets.getModule("command/CommandManager"),
        Validate = require("./validate"),
        Objects = require("./objects");

    const PANEL_ID = "desktop-objects.panel";
    const ICON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">' +
        '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M6 9.5h12"/><path d="M15.5 5v2.2M15.5 12v3"/></svg>';

    let panel, $panel, $icon;
    let current = null;          // object id shown
    let showOpen = true;
    let card = null;
    let refreshTimer = null;

    function html() {
        return `
<div id="desktop-objects-panel" class="dobj">
  <div class="dobj-top">
    <select class="dobj-select" aria-label="Object"></select>
    <button class="dobj-new" title="New Desktop Object">+ New</button>
  </div>
  <div class="dobj-empty">Open a Desktop Objects project to preview objects here.</div>
  <div class="dobj-body">
    <div class="dobj-card">
      <img class="dobj-icon" alt="">
      <div class="dobj-titles"><div class="dobj-name"></div><div class="dobj-tagline"></div></div>
      <span class="dobj-accent" title="accent"></span>
    </div>
    <div class="dobj-toggle" role="group" aria-label="Art">
      <button data-open="false">Closed</button><button data-open="true">Open</button>
    </div>
    <div class="dobj-stage">
      <div class="dobj-art">
        <img class="dobj-art-img" alt="">
        <div class="dobj-area" title="Drag to move where files appear. Drag the corner to resize.">
          <div class="dobj-area-grid"></div><span class="dobj-handle"></span>
        </div>
      </div>
      <div class="dobj-noart">No art yet.</div>
    </div>
    <div class="dobj-area-values"></div>
    <ul class="dobj-problems"></ul>
  </div>
</div>`;
    }

    // MARK: Rendering

    function scheduleRefresh(delay) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, delay || 0);
    }

    async function refresh() {
        if (!panel || !panel.isVisible()) { return; }
        const isProject = await Objects.isDesktopObjectsProject();
        $panel.find(".dobj-empty").toggle(!isProject);
        $panel.find(".dobj-body, .dobj-top").toggle(isProject);
        if (!isProject) { return; }

        const ids = await Objects.listObjects();
        const active = MainViewManager.getCurrentlyViewedPath(MainViewManager.ACTIVE_PANE);
        const fromActive = Objects.objectIdForPath(active);
        if (fromActive && ids.includes(fromActive)) { current = fromActive; }
        if (!ids.includes(current)) { current = ids[0] || null; }

        const $select = $panel.find(".dobj-select").empty();
        ids.forEach(id => $select.append($("<option>").val(id).text(id).prop("selected", id === current)));
        if (!current) { return; }

        const dir = Objects.objectDir(current);
        let text = "";
        try { text = await Objects.readCardText(current); } catch (e) { text = ""; }
        const result = Validate.validate(text, current);
        card = result.card || card || {};

        $panel.find(".dobj-name").text(card.name || current);
        $panel.find(".dobj-tagline").text(card.tagline || "");
        $panel.find(".dobj-accent").css("background", /^#[0-9a-f]{6}$/i.test(card.accent || "") ? card.accent : "transparent")
            .toggle(!!card.accent);
        const iconURL = await Objects.imageURL(dir + "media/icon.png");
        $panel.find(".dobj-icon").attr("src", iconURL || "").toggle(!!iconURL);

        // Template objects have Art/closed.png and Art/open.png; others show their screenshots.
        const shots = Array.isArray(card.screenshots) ? card.screenshots : [];
        const closedURL = await Objects.imageURL(dir + "Art/closed.png") || (shots[0] && await Objects.imageURL(dir + shots[0]));
        const openURL = await Objects.imageURL(dir + "Art/open.png") || (shots[1] && await Objects.imageURL(dir + shots[1])) || closedURL;
        const artURL = showOpen ? openURL : closedURL;
        $panel.find(".dobj-art").toggle(!!artURL);
        $panel.find(".dobj-noart").toggle(!artURL);
        $panel.find(".dobj-art-img").attr("src", artURL || "");
        $panel.find(".dobj-toggle button").each(function () {
            $(this).toggleClass("selected", $(this).data("open") === showOpen);
        });

        const area = card.look && card.look.itemsArea;
        const hasArea = showOpen && Array.isArray(area) && area.length === 4;
        $panel.find(".dobj-area").toggle(hasArea).css("border-color", card.accent || "");
        if (hasArea) { placeArea(area); }
        $panel.find(".dobj-area-values").text(hasArea ? "Files area: [" + area.map(n => +n.toFixed(3)).join(", ") + "]" :
            (showOpen ? "This object draws its own interior, so there is no files area to place." : ""));

        const $problems = $panel.find(".dobj-problems").empty();
        if (result.problems.length === 0) {
            $problems.append($("<li class='ok'>").text("object.json looks good."));
        }
        result.problems.forEach(p => $problems.append($("<li>").text(p.message).on("click", () => openCard(p.pos))));
    }

    function placeArea(area) {
        const [x, y, w, h] = area;
        $panel.find(".dobj-area").css({ left: (x * 100) + "%", bottom: (y * 100) + "%", width: (w * 100) + "%", height: (h * 100) + "%", top: "auto" });
    }

    function openCard(pos) {
        const path = Objects.objectDir(current) + "object.json";
        CommandManager.execute("file.open", { fullPath: path }).done(() => {
            const editor = brackets.getModule("editor/EditorManager").getActiveEditor();
            if (editor && pos) { editor.setCursorPos(pos.line, pos.ch, true); }
        });
    }

    // MARK: Dragging the files area

    function startDrag(event, resizing) {
        if (!card || !card.look || !Array.isArray(card.look.itemsArea)) { return; }
        event.preventDefault();
        const box = $panel.find(".dobj-art")[0].getBoundingClientRect();
        const start = { x: event.clientX, y: event.clientY };
        const from = card.look.itemsArea.slice();
        let area = from;
        const clamp = v => Math.min(1, Math.max(0, v));
        function move(e) {
            const dx = (e.clientX - start.x) / box.width;
            const dy = -(e.clientY - start.y) / box.height;          // y counts up from the bottom
            if (resizing) {
                const w = clamp(Math.max(0.05, from[2] + dx));
                // Dragging down grows the height; the top edge stays put and the bottom stops at the art's edge.
                const h = Math.min(from[1] + from[3], clamp(Math.max(0.05, from[3] - dy)));
                area = [from[0], clamp(from[1] + from[3] - h), Math.min(w, 1 - from[0]), h];
            } else {
                area = [clamp(Math.min(from[0] + dx, 1 - from[2])), clamp(Math.min(from[1] + dy, 1 - from[3])), from[2], from[3]];
            }
            placeArea(area);
            $panel.find(".dobj-area-values").text("Files area: [" + area.map(n => +n.toFixed(3)).join(", ") + "]");
        }
        function up() {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", up);
            writeArea(area.map(n => Math.round(n * 1000) / 1000));
        }
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
    }

    /** Puts the new itemsArea into object.json, as an undoable edit in the open document. */
    function writeArea(area) {
        const path = Objects.objectDir(current) + "object.json";
        DocumentManager.getDocumentForPath(path).done(doc => {
            const text = doc.getText();
            const match = /"itemsArea"\s*:\s*\[[^\]]*\]/.exec(text);
            if (!match) { return; }
            const toPos = index => {
                const lines = text.slice(0, index).split("\n");
                return { line: lines.length - 1, ch: lines[lines.length - 1].length };
            };
            doc.replaceRange('"itemsArea": [' + area.join(", ") + "]", toPos(match.index), toPos(match.index + match[0].length));
            CommandManager.execute("file.open", { fullPath: path });
        });
    }

    // MARK: Setup

    function init(onNewObject) {
        $panel = $(html());
        $("#desktop-objects-toolbar-btn").remove();   // left over from a previous load while developing
        $icon = $('<a href="#" id="desktop-objects-toolbar-btn" title="Desktop Objects" aria-label="Desktop Objects"></a>')
            .html(ICON_SVG)
            .appendTo($("#plugin-icons-bar .buttons"));
        panel = WorkspaceManager.createPluginPanel(PANEL_ID, $panel, 300, $icon, 340);

        // The toolbar icon opens and closes the panel. Phoenix highlights the icon while it is open.
        $icon.on("click", e => {
            e.preventDefault();
            if (panel.isVisible()) { panel.hide(); } else { panel.show(); }
        });
        WorkspaceManager.on(WorkspaceManager.EVENT_WORKSPACE_PANEL_SHOWN, (e, panelID) => {
            if (panelID === PANEL_ID) { scheduleRefresh(); }
        });
        $panel.on("change", ".dobj-select", function () { current = $(this).val(); scheduleRefresh(); });
        $panel.on("click", ".dobj-toggle button", function () { showOpen = $(this).data("open") === true; scheduleRefresh(); });
        $panel.on("click", ".dobj-new", e => { e.preventDefault(); onNewObject(); });
        $panel.on("pointerdown", ".dobj-handle", e => { e.stopPropagation(); startDrag(e.originalEvent, true); });
        $panel.on("pointerdown", ".dobj-area", e => startDrag(e.originalEvent, false));

        // Everything below is event driven. Nothing polls.
        MainViewManager.on("currentFileChange", () => scheduleRefresh(50));
        DocumentManager.on("documentChange", (e, doc) => {
            if (Objects.isCardPath(doc.file.fullPath)) { scheduleRefresh(150); }
        });
        FileSystem.on("change", (e, entry) => {
            if (entry && Objects.objectIdForPath(entry.fullPath || "")) { Objects.forgetImages(); scheduleRefresh(200); }
        });
        ProjectManager.on("projectOpen", () => { Objects.forgetImages(); current = null; scheduleRefresh(100); });
    }

    function show(id) {
        if (id) { current = id; }
        if (!panel.isVisible()) { panel.show(); }
        scheduleRefresh();
    }

    exports.init = init;
    exports.show = show;
});
