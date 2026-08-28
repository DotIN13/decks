/** The composer's model picker: grouped by provider, with no separate provider label. */
import { open, say, settle } from "../harness.mjs";

const { browser, page, errors } = await open({ width: 1600, height: 1000 });
await page.waitForFunction(() => (document.querySelectorAll(".composer select option").length ?? 0) > 0, null, { timeout: 15000 });

const picker = await page.evaluate(() => {
	const select = document.querySelector(".composer select");
	const groups = [...select.querySelectorAll("optgroup")];
	return {
		providerLabels: document.querySelectorAll(".composer .provider").length,
		selected: select.selectedOptions[0]?.textContent,
		selectedGroup: select.selectedOptions[0]?.parentElement?.label,
		selectedValue: select.value,
		groupCount: groups.length,
		groupLabels: groups.map((group) => group.label).sort(),
		providers: [...new Set([...select.querySelectorAll("option")].map((o) => o.value.split("/")[0]))].sort(),
		total: select.querySelectorAll("option").length,
		ungrouped: [...select.querySelectorAll("option")].filter((o) => o.parentElement.tagName !== "OPTGROUP").length,
	};
});
say("no provider label beside the picker", picker.providerLabels === 0);
say(
	"the provider is the group heading of the selected model",
	picker.selectedGroup === picker.selectedValue.split("/")[0],
	`${picker.selectedGroup} / ${picker.selectedValue}`,
);
// One group per provider, whatever the runtime happens to offer. This used to assert
// "more than one group", which is a fact about Pi's model list rather than about grouping:
// the Claude backend has a single provider and failed a check it satisfies perfectly.
say(
	"there is one group per provider",
	picker.groupCount === picker.providers.length && picker.groupLabels.join() === picker.providers.join(),
	`${picker.groupCount} groups for providers [${picker.providers.join(" ")}] over ${picker.total} models`,
);
say("every model sits in a group", picker.ungrouped === 0, `${picker.ungrouped} ungrouped`);
say("the selected option is the session's model", (picker.selected?.length ?? 0) > 0, picker.selected);

const other = await page.evaluate(() => {
	const select = document.querySelector(".composer select");
	return [...select.querySelectorAll("option")].find((o) => o.value !== select.value && o.value.includes("/"))?.value;
});
if (!other) {
	say("picking another provider's model keeps the two in step", false, "only one model is configured");
} else {
	await page.selectOption(".composer select", other);
	await page.waitForFunction((wanted) => document.querySelector(".composer select").value === wanted, other, { timeout: 5000 });
	const after = await page.evaluate(() => {
		const select = document.querySelector(".composer select");
		return { group: select.selectedOptions[0]?.parentElement?.label, value: select.value };
	});
	say(
		"picking another provider's model keeps the two in step",
		after.value === other && other.startsWith(`${after.group}/`),
		`${after.group} / ${after.value}`,
	);
	// Put it back: leaving the agent on a provider without credentials makes the next
	// check's turn fail instantly, which reads as a bug in the app.
	await page.selectOption(".composer select", picker.selectedValue);
	await settle(page, 400);
	say(
		"the model is left as it was found",
		(await page.evaluate(() => document.querySelector(".composer select").value)) === picker.selectedValue,
		picker.selectedValue,
	);
}

say("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
