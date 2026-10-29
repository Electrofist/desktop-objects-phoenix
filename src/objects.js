/*
 * Finding objects in the open project and reading their files.
 * A Desktop Objects project has objects/<id>/object.json for every object.
 */
define(function (require, exports, module) {
    "use strict";

    const FileSystem = brackets.getModule("filesystem/FileSystem"),
        ProjectManager = brackets.getModule("project/ProjectManager"),
        DocumentManager = brackets.getModule("document/DocumentManager");

    function root() {
        const dir = ProjectManager.getProjectRoot();
        return dir ? dir.fullPath : null;
    }

    /** "fridge" for <root>/objects/fridge/anything, otherwise null. */
    function objectIdForPath(fullPath) {
        const r = root();
        if (!r || !fullPath || !fullPath.startsWith(r + "objects/")) { return null; }
        const id = fullPath.slice((r + "objects/").length).split("/")[0];
        return id || null;
    }

    function objectDir(id) { return root() + "objects/" + id + "/"; }

    function isCardPath(fullPath) {
        const id = objectIdForPath(fullPath);
        return !!id && fullPath === objectDir(id) + "object.json";
    }

    /** True when the open project looks like a Desktop Objects repo. */
    function isDesktopObjectsProject() {
        return new Promise(resolve => {
            const r = root();
            if (!r) { return resolve(false); }
            FileSystem.getDirectoryForPath(r + "objects/").exists((err, exists) => resolve(!err && exists));
        });
    }

    /** Ids of every folder in objects/ that has an object.json. */
    function listObjects() {
        return new Promise(resolve => {
            const r = root();
            if (!r) { return resolve([]); }
            FileSystem.getDirectoryForPath(r + "objects/").getContents((err, entries) => {
                if (err || !entries) { return resolve([]); }
                const dirs = entries.filter(e => e.isDirectory).map(e => e.name).sort();
                Promise.all(dirs.map(id => exists(objectDir(id) + "object.json").then(ok => ok ? id : null)))
                    .then(ids => resolve(ids.filter(Boolean)));
            });
        });
    }

    function exists(fullPath) {
        return new Promise(resolve => {
            FileSystem.resolve(fullPath, err => resolve(!err));
        });
    }

    /** The card's text: the open document if there is one (so unsaved edits count), else the file. */
    function readCardText(id) {
        const path = objectDir(id) + "object.json";
        const doc = DocumentManager.getOpenDocumentForPath(path);
        if (doc) { return Promise.resolve(doc.getText()); }
        return readText(path);
    }

    function readText(fullPath) {
        return new Promise((resolve, reject) => {
            // doNotCache: files changed outside Phoenix (git pull, scripts) must be read fresh.
            FileSystem.getFileForPath(fullPath).read({ doNotCache: true }, (err, text) => err ? reject(err) : resolve(text));
        });
    }

    const urlCache = new Map();   // fullPath -> object URL, released when the file changes

    /** An image file as a URL an <img> can show, or null if it does not exist. */
    function imageURL(fullPath) {
        if (urlCache.has(fullPath)) { return Promise.resolve(urlCache.get(fullPath)); }
        return new Promise(resolve => {
            FileSystem.getFileForPath(fullPath).read({ encoding: "binary", doNotCache: true }, (err, bytes) => {
                if (err || !bytes) { return resolve(null); }
                const type = fullPath.endsWith(".png") ? "image/png" :
                    fullPath.endsWith(".gif") ? "image/gif" : "image/jpeg";
                const url = URL.createObjectURL(new Blob([bytes], { type }));
                urlCache.set(fullPath, url);
                resolve(url);
            });
        });
    }

    function forgetImages() {
        urlCache.forEach(url => URL.revokeObjectURL(url));
        urlCache.clear();
    }

    exports.root = root;
    exports.objectIdForPath = objectIdForPath;
    exports.objectDir = objectDir;
    exports.isCardPath = isCardPath;
    exports.isDesktopObjectsProject = isDesktopObjectsProject;
    exports.listObjects = listObjects;
    exports.exists = exists;
    exports.readCardText = readCardText;
    exports.readText = readText;
    exports.imageURL = imageURL;
    exports.forgetImages = forgetImages;
});
