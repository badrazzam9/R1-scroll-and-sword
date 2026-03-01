fetch("https://scroll-and-sword-api.swordandscroll.workers.dev/", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({ theme: "medieval", hp: 10, act: 1, step: 1 })
})
    .then(async r => console.log(r.status, await r.text()))
    .catch(console.error);
