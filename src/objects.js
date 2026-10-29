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
        const r = root();
        return r ? exists(r + "objects/") : Promise.resolve(false);
    }

    /** Names in a folder, read fresh from disk. */
    function readNames(dirPath) {
        return new Promise(resolve => {
            if (window.Phoenix && Phoenix.fs && Phoenix.fs.readdir) {
                Phoenix.fs.readdir(dirPath, (err, names) => resolve(err || !names ? [] : names.map(String)));
            } else {
                FileSystem.getDirectoryForPath(dirPath).getContents((err, entries) =>
                    resolve(err || !entries ? [] : entries.map(e => e.name)));
            }
        });
    }

    /** Ids of every folder in objects/ that has an object.json. */
    async function listObjects() {
        const r = root();
        if (!r) { return []; }
        const names = (await readNames(r + "objects/")).filter(n => !n.startsWith(".")).sort();
        const ids = await Promise.all(names.map(id => exists(objectDir(id) + "object.json").then(ok => ok ? id : null)));
        return ids.filter(Boolean);
    }

    // Reads go through Phoenix.fs, which always sees the file on disk. FileSystem's cache can lag
    // behind changes made outside Phoenix (git pull, scripts, other editors).
    function rawRead(fullPath, encoding) {
        return new Promise((resolve, reject) => {
            const done = (err, data) => err ? reject(err) : resolve(data);
            if (window.Phoenix && Phoenix.fs && Phoenix.fs.readFile) {
                encoding ? Phoenix.fs.readFile(fullPath, encoding, done) : Phoenix.fs.readFile(fullPath, done);
            } else {
                FileSystem.getFileForPath(fullPath).read({ encoding: encoding || "binary", doNotCache: true }, done);
            }
        });
    }

    function exists(fullPath) {
        return new Promise(resolve => {
            if (window.Phoenix && Phoenix.fs && Phoenix.fs.stat) {
                Phoenix.fs.stat(fullPath, err => resolve(!err));
            } else {
                FileSystem.resolve(fullPath, err => resolve(!err));
            }
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
        return rawRead(fullPath, "utf8").then(String);
    }

    // Object URLs made for the current render; the previous render's are released after it.
    let liveURLs = [], previousURLs = [];

    /** An image file as a URL an <img> can show, or null if it does not exist. */
    function imageURL(fullPath) {
        return rawRead(fullPath).then(bytes => {
            const type = fullPath.endsWith(".png") ? "image/png" :
                fullPath.endsWith(".gif") ? "image/gif" : "image/jpeg";
            const url = URL.createObjectURL(new Blob([bytes], { type }));
            liveURLs.push(url);
            return url;
        }).catch(() => null);
    }

    /** Call before a render: images made from now on belong to the new render. */
    function beginImages() {
        previousURLs = previousURLs.concat(liveURLs);
        liveURLs = [];
    }

    /** Call after a render has swapped in its images: frees the old ones. */
    function endImages() {
        previousURLs.forEach(url => URL.revokeObjectURL(url));
        previousURLs = [];
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
    exports.beginImages = beginImages;
    exports.endImages = endImages;
});
