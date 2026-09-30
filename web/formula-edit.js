class FormulaEditHistory {
  constructor(source) {
    this.reset(source);
  }
  reset(source) {
    this.baseline = source;
    this.entries = [source];
    this.index = 0;
  }
  get source() {
    return this.entries[this.index];
  }
  get dirty() {
    return this.source !== this.baseline;
  }
  get started() {
    return this.entries.length > 1;
  }
  get canUndo() {
    return this.index > 0;
  }
  get canRedo() {
    return this.index < this.entries.length - 1;
  }
  push(source) {
    if (source === this.source) return;
    this.entries.splice(this.index + 1);
    this.entries.push(source);
    this.index++;
  }
  undo() {
    if (this.canUndo) this.index--;
    return this.source;
  }
  redo() {
    if (this.canRedo) this.index++;
    return this.source;
  }
}
class FlowEditHistory {
  constructor() {
    this.reset();
  }
  reset() {
    this.entries = [];
    this.index = 0;
  }
  get changes() {
    return this.entries.slice(0, this.index);
  }
  get started() {
    return this.entries.length > 0;
  }
  get dirty() {
    return this.index > 0;
  }
  get canUndo() {
    return this.index > 0;
  }
  get canRedo() {
    return this.index < this.entries.length;
  }
  push(change) {
    this.entries.splice(this.index);
    this.entries.push(change);
    this.index++;
  }
}
if (typeof module !== 'undefined' && module.exports)
  module.exports = { FormulaEditHistory, FlowEditHistory };
