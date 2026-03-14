/**
 * TalkingMaps – Undo/Redo Manager
 * Snapshot-based undo/redo for the story editor.
 * Stores deep-cloned copies of the entire slides array.
 */
const UndoManager = {
    _history: [],
    _pointer: -1,
    _maxHistory: 50,

    /**
     * Reset history (call when loading a new story).
     */
    reset() {
        this._history = [];
        this._pointer = -1;
    },

    /**
     * Push a snapshot of the current slides state.
     * Trims any future states after the current pointer (discards redo stack).
     * @param {Array} slides - the slides array to snapshot
     */
    push(slides) {
        // Deep clone to avoid reference issues
        const snapshot = JSON.parse(JSON.stringify(slides));

        // If we are not at the end, trim future history
        if (this._pointer < this._history.length - 1) {
            this._history = this._history.slice(0, this._pointer + 1);
        }

        this._history.push(snapshot);

        // Enforce max history limit
        if (this._history.length > this._maxHistory) {
            this._history.shift();
        }

        this._pointer = this._history.length - 1;
    },

    /**
     * Undo: return the previous state, or null if nothing to undo.
     * @returns {Array|null} deep-cloned slides array or null
     */
    undo() {
        if (!this.canUndo()) return null;
        this._pointer--;
        return JSON.parse(JSON.stringify(this._history[this._pointer]));
    },

    /**
     * Redo: return the next state, or null if nothing to redo.
     * @returns {Array|null} deep-cloned slides array or null
     */
    redo() {
        if (!this.canRedo()) return null;
        this._pointer++;
        return JSON.parse(JSON.stringify(this._history[this._pointer]));
    },

    /**
     * @returns {boolean} true if undo is available
     */
    canUndo() {
        return this._pointer > 0;
    },

    /**
     * @returns {boolean} true if redo is available
     */
    canRedo() {
        return this._pointer < this._history.length - 1;
    },
};
