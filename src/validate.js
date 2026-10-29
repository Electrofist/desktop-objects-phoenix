/*
 * Checks an object.json card. Mirrors scripts/check-objects.sh in the Desktop Objects repo,
 * so what Phoenix shows while you type matches what GitHub checks on a pull request.
 */
define(function (require, exports, module) {
    "use strict";

    const REQUIRED = ["id", "name", "tagline", "description", "author.name", "version",
        "minMacOS", "license", "build.command", "build.app"];

    function get(obj, path) {
        return path.split(".").reduce((o, k) => (o && typeof o === "object") ? o[k] : undefined, obj);
    }

    /** Line and column (0-based) of the first `"key"` in the text, or the top of the file. */
    function positionOf(text, key) {
        const last = key.split(".").pop();
        const index = text.search(new RegExp('"' + last.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"\\s*:'));
        if (index < 0) { return { line: 0, ch: 0 }; }
        const before = text.slice(0, index).split("\n");
        return { line: before.length - 1, ch: before[before.length - 1].length };
    }

    /** Position of a JSON.parse error, from the engine's message when it gives one. */
    function parseErrorPosition(text, error) {
        const lc = /line (\d+) column (\d+)/.exec(error.message);
        if (lc) { return { line: Number(lc[1]) - 1, ch: Number(lc[2]) - 1 }; }
        const at = /position (\d+)/.exec(error.message);
        if (at) {
            const before = text.slice(0, Number(at[1])).split("\n");
            return { line: before.length - 1, ch: before[before.length - 1].length };
        }
        return { line: 0, ch: 0 };
    }

    /**
     * @param {string} text      the card's text (may be unsaved)
     * @param {string} folderId  the folder the card lives in, e.g. "fridge"
     * @return {{card: ?Object, problems: Array<{key: string, message: string, pos: Object}>}}
     */
    function validate(text, folderId) {
        const problems = [];
        let card;
        try {
            card = JSON.parse(text);
        } catch (e) {
            return { card: null, problems: [{ key: "", message: "This is not valid JSON: " + e.message, pos: parseErrorPosition(text, e) }] };
        }
        const add = (key, message) => problems.push({ key, message, pos: positionOf(text, key) });

        for (const key of REQUIRED) {
            const value = get(card, key);
            if (value === undefined || value === null || value === "") { add(key, `Missing "${key}".`); }
        }
        if (card.id && folderId && card.id !== folderId) {
            add("id", `"id" is "${card.id}" but the folder is "${folderId}". They must match.`);
        }
        if (folderId && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(folderId)) {
            add("id", "The folder name must be lowercase letters, digits and hyphens, like air-fryer.");
        }
        if (card.version && !/^\d+(\.\d+){1,2}$/.test(card.version)) {
            add("version", 'Version must look like "1.0" or "1.0.0".');
        }
        if (card.minMacOS && !(/^\d+(\.\d+)?$/.test(card.minMacOS) && parseFloat(card.minMacOS) >= 14)) {
            add("minMacOS", 'minMacOS must be "14.0" or later.');
        }
        if (typeof card.tagline === "string" && card.tagline.length > 100) {
            add("tagline", `The tagline is ${card.tagline.length} characters. Keep it to 100.`);
        }
        if (card.tagline === "Write one line about your object here.") {
            add("tagline", "Write your own tagline.");
        }
        if (typeof card.description === "string" && card.description.startsWith("Write a few sentences")) {
            add("description", "Write your own description.");
        }
        if (card.accent !== undefined && !/^#[0-9a-fA-F]{6}$/.test(card.accent)) {
            add("accent", 'accent must be a colour like "#6CCBF0".');
        }
        const area = get(card, "look.itemsArea");
        if (area !== undefined && !(Array.isArray(area) && area.length === 4 &&
                area.every(n => typeof n === "number" && n >= 0 && n <= 1))) {
            add("itemsArea", "look.itemsArea must be four numbers from 0 to 1: x, y, width, height.");
        }
        const icon = get(card, "look.iconSize");
        if (icon !== undefined && !(typeof icon === "number" && icon >= 24 && icon <= 128)) {
            add("iconSize", "look.iconSize must be a number from 24 to 128.");
        }
        if (card.screenshots !== undefined && !Array.isArray(card.screenshots)) {
            add("screenshots", "screenshots must be a list of paths.");
        }
        return { card, problems };
    }

    /** Files the card points to, relative to the object's folder, for existence checks. */
    function referencedFiles(card) {
        const files = [];
        const command = get(card, "build.command");
        if (typeof command === "string") {
            files.push({ key: "command", path: command.trim().split(/\s+/).pop() });
        }
        if (Array.isArray(card.screenshots)) {
            card.screenshots.forEach(s => typeof s === "string" && files.push({ key: "screenshots", path: s }));
        }
        return files;
    }

    exports.validate = validate;
    exports.referencedFiles = referencedFiles;
    exports.positionOf = positionOf;
});
