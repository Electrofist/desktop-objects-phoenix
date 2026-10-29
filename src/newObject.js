/*
 * "New Desktop Object…": the same as scripts/new-object.sh in the Desktop Objects repo,
 * but inside Phoenix. Copies templates/object to objects/<id>, fills in the names,
 * adds a CODEOWNERS line, and opens the new object.json.
 */
define(function (require, exports, module) {
    "use strict";

    const FileSystem = brackets.getModule("filesystem/FileSystem"),
        Dialogs = brackets.getModule("widgets/Dialogs"),
        DefaultDialogs = brackets.getModule("widgets/DefaultDialogs"),
        CommandManager = brackets.getModule("command/CommandManager"),
        Objects = require("./objects");

    const TEXT_FILE = /\.(swift|json|md|sh|plist)$/;

    function names(name, github, author) {
        const id = name.toLowerCase().replace(/\s+/g, "-").replace(/-+/g, "-");
        const exec = "Desktop" + name.replace(/[^A-Za-z0-9]/g, "");
        const owner = github.toLowerCase().replace(/[^a-z0-9-]/g, "") || "unknown";
        return {
            __ID__: id,
            __EXEC__: exec,
            __APP_NAME__: "Desktop " + name,
            __FOLDER__: name,
            __BUNDLE_ID__: "io.github." + owner + "." + id.replace(/-/g, ""),
            __AUTHOR__: author || github || "Your Name",
            __GITHUB__: github || "your-github-username"
        };
    }

    function fill(text, values) {
        return Object.keys(values).reduce((t, key) => t.split(key).join(values[key]), text);
    }

    const call = (fn) => new Promise((resolve, reject) => fn((err, result) => err ? reject(err) : resolve(result)));

    async function copyTree(fromDir, toDir, values) {
        await call(cb => FileSystem.getDirectoryForPath(toDir).create(cb)).catch(() => {});
        const entries = await call(cb => FileSystem.getDirectoryForPath(fromDir).getContents(cb));
        for (const entry of entries) {
            const targetName = fill(entry.name, values);       // Sources/__EXEC__ becomes Sources/DesktopToaster
            if (entry.isDirectory) {
                await copyTree(entry.fullPath, toDir + targetName + "/", values);
            } else if (TEXT_FILE.test(entry.name)) {
                const text = await call(cb => entry.read({}, cb));
                await call(cb => FileSystem.getFileForPath(toDir + targetName).write(fill(text, values), { blind: true }, cb));
            } else {
                await call(cb => FileSystem.copy(entry.fullPath, toDir + targetName, cb));
            }
        }
    }

    async function addOwner(id, github) {
        const path = Objects.root() + ".github/CODEOWNERS";
        let text = "";
        try { text = await Objects.readText(path); } catch (e) { return; }
        const line = ("/objects/" + id + "/").padEnd(19) + " @" + (github || "your-github-username") + "\n";
        if (!text.endsWith("\n")) { text += "\n"; }
        await call(cb => FileSystem.getFileForPath(path).write(text + line, { blind: true }, cb));
    }

    function ask() {
        return new Promise(resolve => {
            const body = `
<p>Pick a name. You get a working object to fill with your own art.</p>
<label style="display:block;margin:10px 0 4px">Object name</label>
<input class="dobj-input-name" type="text" placeholder="Air Fryer" style="width:100%">
<label style="display:block;margin:10px 0 4px">Your GitHub username</label>
<input class="dobj-input-github" type="text" placeholder="octocat" style="width:100%">`;
            const dialog = Dialogs.showModalDialog(DefaultDialogs.DIALOG_ID_INFO, "New Desktop Object", body, [
                { className: Dialogs.DIALOG_BTN_CLASS_NORMAL, id: Dialogs.DIALOG_BTN_CANCEL, text: "Cancel" },
                { className: Dialogs.DIALOG_BTN_CLASS_PRIMARY, id: Dialogs.DIALOG_BTN_OK, text: "Create" }
            ]);
            const $el = dialog.getElement();
            let values = { name: "", github: "" };
            $el.on("input", "input", () => {
                values = { name: $el.find(".dobj-input-name").val().trim(), github: $el.find(".dobj-input-github").val().trim() };
            });
            setTimeout(() => $el.find(".dobj-input-name").trigger("focus"), 50);
            dialog.done(button => resolve(button === Dialogs.DIALOG_BTN_OK ? values : null));
        });
    }

    function tell(title, message) {
        Dialogs.showModalDialog(DefaultDialogs.DIALOG_ID_INFO, title, message);
    }

    async function run(onCreated) {
        if (!(await Objects.isDesktopObjectsProject())) {
            tell("Open the Desktop Objects repo first", "This command adds an object to a copy of the Desktop Objects repo. Open your fork's folder, then try again.");
            return;
        }
        const answer = await ask();
        if (!answer) { return; }
        if (!/^[A-Za-z][A-Za-z0-9 -]*$/.test(answer.name)) {
            tell("That name will not work", "Use letters, digits, spaces and hyphens, starting with a letter. For example: Air Fryer.");
            return;
        }
        const values = names(answer.name, answer.github, answer.github);
        const id = values.__ID__;
        const dest = Objects.objectDir(id);
        if (await Objects.exists(dest)) {
            tell("That object already exists", "There is already a folder objects/" + id + ". Pick another name.");
            return;
        }
        const template = Objects.root() + "templates/object/";
        if (!(await Objects.exists(template))) {
            tell("Template not found", "This project has no templates/object folder. Update your fork from the main repo.");
            return;
        }
        try {
            await copyTree(template, dest, values);
            await addOwner(id, answer.github);
        } catch (e) {
            tell("Could not create the object", String(e));
            return;
        }
        await call(cb => CommandManager.execute("file.open", { fullPath: dest + "object.json" }).always(() => cb()));
        onCreated(id);
        tell(values.__APP_NAME__ + " is ready", `
<p>Your object is in <b>objects/${id}</b>.</p>
<ol>
<li>See it on your desktop: in the Terminal, run <code>cd objects/${id} &amp;&amp; bash build.sh run</code></li>
<li>Replace <b>Art/closed.png</b> and <b>Art/open.png</b> with your art.</li>
<li>Write your tagline and description in <b>object.json</b>. The Desktop Objects panel shows problems as you type, and you can drag the files area into place there.</li>
</ol>
<p>The full guide is in <b>docs/make-your-own.md</b>.</p>`);
    }

    exports.run = run;
    exports._names = names;
});
