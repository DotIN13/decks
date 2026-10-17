use super::*;
use layout::Estimate;
use serde_json::json;
use stage_doc::Change;

fn doc(v: Value) -> Document {
	Document::from_json(v).unwrap()
}

fn rect_of(scene: &Scene, d: &Document, id: &str) -> Rect {
	for root in &scene.roots {
		if let Some(i) = root.tree.items.iter().position(|it| it.id == id) {
			return root.placed[i].rect;
		}
	}
	let _ = d;
	panic!("no {id}")
}

#[test]
fn rows_columns_and_fills() {
	let d = doc(json!({"children":[
		{"type":"frame","id":"row","x":10,"y":20,"width":300,"height":50,"gap":10,"padding":[5,10],"children":[
			{"type":"rectangle","id":"a","width":50,"height":40},
			{"type":"rectangle","id":"b","width":"fill_container","height":"fill_container"},
			{"type":"rectangle","id":"c","width":50,"height":20}
		]},
		{"type":"frame","id":"col","layout":"vertical","alignItems":"center","x":0,"y":200,"children":[
			{"type":"rectangle","id":"d","width":100,"height":10},
			{"type":"rectangle","id":"e","width":40,"height":10,"enabled":false},
			{"type":"rectangle","id":"f","width":20,"height":10}
		]}
	]}));
	let s = Scene::new(&d, false, &Estimate);
	assert_eq!(rect_of(&s, &d, "row"), Rect { x: 10.0, y: 20.0, w: 300.0, h: 50.0 });
	assert_eq!(rect_of(&s, &d, "a"), Rect { x: 20.0, y: 25.0, w: 50.0, h: 40.0 });
	// 300 - 20 padding - 100 fixed - 20 gaps = 160, and the full cross of 40.
	assert_eq!(rect_of(&s, &d, "b"), Rect { x: 80.0, y: 25.0, w: 160.0, h: 40.0 });
	assert_eq!(rect_of(&s, &d, "c").x, 250.0);
	assert_eq!(rect_of(&s, &d, "col").h, 20.0);
	assert_eq!(rect_of(&s, &d, "f"), Rect { x: 40.0, y: 210.0, w: 20.0, h: 10.0 });
}

#[test]
fn groups_are_their_childrens_box() {
	let d = doc(json!({"children":[{"type":"group","id":"g","x":100,"y":100,"children":[
		{"type":"rectangle","id":"a","x":10,"y":10,"width":10,"height":10},
		{"type":"ellipse","id":"b","x":50,"y":0,"width":20,"height":40}
	]}]}));
	let s = Scene::new(&d, false, &Estimate);
	assert_eq!(rect_of(&s, &d, "g"), Rect { x: 110.0, y: 100.0, w: 60.0, h: 40.0 });
}

#[test]
fn an_edit_lays_out_only_its_root() {
	let mut d = doc(json!({"children":[
		{"type":"rectangle","id":"a","width":10,"height":10},
		{"type":"rectangle","id":"b","x":100,"width":10,"height":10}
	]}));
	let mut s = Scene::new(&d, false, &Estimate);
	let applied = d.apply(&[Change::Set { id: "a".into(), key: "width".into(), value: Some(json!(30)) }]).unwrap();
	let up = s.update(&d, Some(&applied), &Estimate);
	assert_eq!(up.roots.len(), 1);
	assert_eq!(up.roots[0].0, d.handle("a").unwrap());
	assert_eq!(up.roots[0].1.unwrap().w, 10.0);
	assert_eq!(rect_of(&s, &d, "a").w, 30.0);
}

#[test]
fn editing_a_component_updates_its_instances() {
	let mut d = doc(json!({"children":[
		{"type":"rectangle","id":"comp","reusable":true,"width":10,"height":10},
		{"type":"ref","id":"i1","ref":"comp","x":100},
		{"type":"rectangle","id":"other","x":300}
	]}));
	let mut s = Scene::new(&d, false, &Estimate);
	let applied = d.apply(&[Change::Set { id: "comp".into(), key: "width".into(), value: Some(json!(44)) }]).unwrap();
	let up = s.update(&d, Some(&applied), &Estimate);
	let ids: Vec<&str> = up.roots.iter().map(|(h, _)| d.node(*h).unwrap().id.as_str()).collect();
	assert_eq!(ids, vec!["comp", "i1"]);
	assert_eq!(rect_of(&s, &d, "i1"), Rect { x: 100.0, y: 0.0, w: 44.0, h: 10.0 });
}

#[test]
fn removing_and_inserting_at_the_top() {
	let mut d = doc(json!({"children":[{"type":"rectangle","id":"a"},{"type":"rectangle","id":"b"}]}));
	let mut s = Scene::new(&d, false, &Estimate);
	let applied = d
		.apply(&[
			Change::Remove { id: "a".into() },
			Change::Insert { id: "n".into(), parent: None, pos: d.pos_last(None) + "V", props: serde_json::from_value(json!({"type":"ellipse"})).unwrap(), list: false },
		])
		.unwrap();
	let up = s.update(&d, Some(&applied), &Estimate);
	assert_eq!(up.removed.len(), 1);
	assert_eq!(up.removed[0].0, "a");
	assert!(up.reordered);
	assert_eq!(s.roots.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["b", "n"]);
}

#[test]
fn picking_takes_the_topmost_and_respects_shapes_and_turns() {
	let d = doc(json!({"children":[
		{"type":"rectangle","id":"under","width":100,"height":100},
		{"type":"frame","id":"f","x":20,"y":20,"layout":"none","width":60,"height":60,"children":[
			{"type":"ellipse","id":"e","x":0,"y":0,"width":60,"height":60}
		]},
		{"type":"rectangle","id":"turned","x":200,"y":100,"width":100,"height":10,"rotation":90}
	]}));
	let s = Scene::new(&d, false, &Estimate);
	assert_eq!(s.pick(50.0, 50.0, 0.0).unwrap().path, vec!["f", "e"]);
	// The ellipse's corner is outside it: the frame under it answers.
	assert_eq!(s.pick(22.0, 22.0, 0.0).unwrap().id, "f");
	assert_eq!(s.pick(5.0, 5.0, 0.0).unwrap().id, "under");
	// Turned ninety degrees counter-clockwise about its corner, it stands up from (200, 100).
	assert_eq!(s.pick(205.0, 50.0, 0.0).unwrap().id, "turned");
	assert!(s.pick(250.0, 105.0, 0.0).is_none());
	let marquee_all = s.within(&Rect { x: -1.0, y: -1.0, w: 400.0, h: 400.0 });
	assert_eq!(marquee_all.len(), 4);
	let marquee = s.within(&Rect { x: 15.0, y: 15.0, w: 70.0, h: 70.0 });
	assert_eq!(marquee.len(), 2);
}

/// Every stage saved on this Mac lays out, and how long it takes.
#[test]
fn real_stages_lay_out() {
	let Ok(root) = std::env::var("STAGE_FIXTURES") else { return };
	let mut files = Vec::new();
	collect(std::path::Path::new(&root), &mut files);
	let (mut items, mut total, mut worst) = (0usize, 0.0f64, (0.0f64, String::new()));
	for path in files {
		let Ok(text) = std::fs::read_to_string(&path) else { continue };
		let Ok(d) = Document::parse(&text) else { continue };
		let start = std::time::Instant::now();
		let s = Scene::new(&d, false, &Estimate);
		let ms = start.elapsed().as_secs_f64() * 1000.0;
		items += s.roots.iter().map(|r| r.tree.items.len()).sum::<usize>();
		total += ms;
		if ms > worst.0 {
			worst = (ms, path.display().to_string());
		}
	}
	eprintln!("{items} items laid out in {total:.1} ms; slowest stage {:.2} ms ({})", worst.0, worst.1);
}

fn collect(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
	if let Ok(read) = std::fs::read_dir(dir) {
		for e in read.flatten() {
			let p = e.path();
			if p.is_dir() {
				collect(&p, out);
			} else if p.extension().is_some_and(|x| x == "pen") {
				out.push(p);
			}
		}
	}
}

#[test]
fn a_turned_frame_turns_its_children() {
	let d = doc(json!({"children":[{"type":"frame","id":"f","x":100,"y":100,"width":100,"height":20,"rotation":90,"layout":"none","children":[
		{"type":"rectangle","id":"r","x":80,"y":0,"width":20,"height":20}
	]}]}));
	let s = Scene::new(&d, false, &Estimate);
	// The child's far end is 90 units along the frame, which now points up from (100, 100).
	assert_eq!(s.pick(110.0, 15.0, 0.0).unwrap().id, "r");
	assert_eq!(s.pick(110.0, 95.0, 0.0).unwrap().id, "f");
}
