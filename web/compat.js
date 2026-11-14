'use strict';

// Workspace data is JSON. Older WebViews can use the same data model without native cloning.
function cloneWorkspace(value) {
  return typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
}
if(typeof HTMLDialogElement==='undefined'||typeof HTMLDialogElement.prototype.showModal!=='function'){
  document.documentElement.classList.add('dialog-fallback');
  for(const dialog of document.querySelectorAll('dialog'))window.dialogPolyfill.registerDialog(dialog);
}
