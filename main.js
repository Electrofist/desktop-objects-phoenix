/*
 * Desktop Objects Studio: preview, check and create Desktop Objects in Phoenix Code.
 * https://github.com/Electrofist/desktop-objects
 *
 * - A side panel (toolbar icon) with a live preview of the object you are editing, where
 *   you can drag the files area into place.
 * - Problems in object.json show as you type, using the same rules as the repo's CI.
 * - File > New Desktop Object… creates a new object from the repo's template.
 */
define(function (require, exports, module) {
    "use strict";

    const AppInit = brackets.getModule("utils/AppInit"),
        ExtensionUtils = brackets.getModule("utils/ExtensionUtils"),
        CommandManager = brackets.getModule("command/CommandManager"),
        Menus = brackets.getModule("command/Menus"),
        CodeInspection = brackets.getModule("language/CodeInspection"),
        Validate = require("./src/validate"),
        Objects = require("./src/objects"),
        Panel = require("./src/panel"),
        NewObject = require("./src/newObject");

    const NEW_OBJECT = "desktop-objects.newObject";

    /** Problems for objects/<id>/object.json, shown in Phoenix's Problems panel and gutter. */
    function scanFileAsync(text, fullPath) {
        const result = new $.Deferred();
        if (!Objects.isCardPath(fullPath)) { return result.resolve(null).promise(); }
        const id = Objects.objectIdForPath(fullPath);
        const { card, problems } = Validate.validate(text, id);
        const errors = problems.map(p => ({ pos: p.pos, message: p.message, type: CodeInspection.Type.ERROR }));
        if (!card) { return result.resolve({ errors }).promise(); }
        Promise.all(Validate.referencedFiles(card).map(ref =>
            Objects.exists(Objects.objectDir(id) + ref.path).then(ok => ok ? null : {
                pos: Validate.positionOf(text, ref.key),
                message: `"${ref.path}" is not in objects/${id}/.`,
                type: CodeInspection.Type.WARNING
            })
        )).then(missing => result.resolve({ errors: errors.concat(missing.filter(Boolean)) }));
        return result.promise();
    }

    AppInit.appReady(function () {
        ExtensionUtils.loadStyleSheet(module, "styles/panel.css");

        CodeInspection.register("json", { name: "Desktop Objects", scanFileAsync });

        Panel.init(() => NewObject.run(id => Panel.show(id)));
        // Guarded so reloading the extension while developing it does not add a second menu item.
        if (!CommandManager.get(NEW_OBJECT)) {
            CommandManager.register("New Desktop Object…", NEW_OBJECT, () => NewObject.run(id => Panel.show(id)));
            Menus.getMenu(Menus.AppMenuBar.FILE_MENU).addMenuItem(NEW_OBJECT);
        }
    });
});
