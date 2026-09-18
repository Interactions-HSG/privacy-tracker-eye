// Step navigation for the study fixture.
//
// Forms are NOT submitted anywhere: the handler cancels the submit and moves to
// the next step. Nothing a participant types is sent, stored, or put in a URL —
// the entries live in the input elements and disappear with the page.

(() => {
  "use strict";
  const next = (document.currentScript && document.currentScript.dataset.next) || "index.html";
  const form = document.getElementById("form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    // Let the mock-tracking submit beacon fire before the page changes.
    setTimeout(() => { location.href = next; }, 120);
  });
})();
