/** The popup: pair once, share the current tab, see what is shared, stop. */
const $ = (id) => document.getElementById(id);

function ask(message) {
	return new Promise((resolve, reject) => {
		chrome.runtime.sendMessage(message, (response) => {
			if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
			if (!response?.ok) return reject(new Error(response?.error ?? "no answer"));
			resolve(response.result);
		});
	});
}

function draw(status) {
	const box = $("status");
	box.dataset.on = status.connected ? "true" : "false";
	if (!status.paired) {
		box.textContent = "Not paired yet. Open Pairing below and enter the Decks address and code.";
		$("pairing").open = true;
	} else if (status.connected) {
		box.textContent = `Connected to ${status.address}`;
		for (const tab of status.tabs) {
			const row = document.createElement("div");
			row.className = "tab";
			row.textContent = `${tab.title || "(untitled)"} — ${tab.url}`;
			box.append(row);
		}
	} else {
		box.textContent = status.wanted ? `Paired with ${status.address}. Reconnecting…` : `Paired with ${status.address}. Nothing shared.`;
	}
	$("share").hidden = false;
	$("stop").hidden = !status.connected && !status.wanted;
	$("error").textContent = status.error ?? "";
	$("address").value = status.address ?? "";
}

async function refresh() {
	try {
		draw(await ask({ type: "status" }));
	} catch (error) {
		$("error").textContent = error.message;
	}
}

$("save").addEventListener("click", async () => {
	try {
		draw(await ask({ type: "pair", address: $("address").value, code: $("code").value }));
		$("pairing").open = false;
	} catch (error) {
		$("error").textContent = error.message;
	}
});

$("share").addEventListener("click", async () => {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) throw new Error("No active tab");
		draw(await ask({ type: "share", tabId: tab.id }));
	} catch (error) {
		$("error").textContent = error.message;
	}
});

$("stop").addEventListener("click", async () => {
	try {
		draw(await ask({ type: "stop" }));
	} catch (error) {
		$("error").textContent = error.message;
	}
});

void refresh();
