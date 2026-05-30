(function () {
  document.querySelectorAll(".faq-item").forEach(function (item) {
    var q = item.querySelector(".faq-q");
    var a = item.querySelector(".faq-a");
    if (!q || !a) return;
    q.addEventListener("click", function () {
      var open = item.classList.toggle("is-open");
      a.hidden = !open;
      q.setAttribute("aria-expanded", open ? "true" : "false");
    });
    a.hidden = !item.classList.contains("is-open");
    q.setAttribute("aria-expanded", item.classList.contains("is-open") ? "true" : "false");
  });

  var header = document.querySelector(".site-header");
  function onScroll() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();
