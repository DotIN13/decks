//! The C interface, `include/decks_engine.h`, and nothing else: every call checks its arguments,
//! catches a panic, and leaves a refusal's reason for `decks_engine_error`.

use crate::engine::Engine;
use crate::frame::View;
use serde_json::Value;
use std::cell::RefCell;
use std::ffi::{CStr, CString, c_char, c_void};
use std::panic::{AssertUnwindSafe, catch_unwind};

thread_local! {
	static ERROR: RefCell<CString> = RefCell::new(CString::default());
}

fn fail(reason: impl Into<String>) {
	let text = reason.into().replace('\0', " ");
	ERROR.with(|e| *e.borrow_mut() = CString::new(text).unwrap_or_default());
}

/// Run `f`, turning a refusal or a panic into `fallback` and a reason.
fn guard<T>(fallback: T, f: impl FnOnce() -> Result<T, String>) -> T {
	match catch_unwind(AssertUnwindSafe(f)) {
		Ok(Ok(v)) => v,
		Ok(Err(reason)) => {
			fail(reason);
			fallback
		}
		Err(_) => {
			fail("the engine stopped on an internal error");
			fallback
		}
	}
}

fn text<'a>(s: *const c_char, name: &str) -> Result<&'a str, String> {
	if s.is_null() {
		return Err(format!("{name} is missing"));
	}
	unsafe { CStr::from_ptr(s) }.to_str().map_err(|_| format!("{name} is not UTF-8"))
}

fn engine<'a>(e: *mut Engine) -> Result<&'a mut Engine, String> {
	unsafe { e.as_mut() }.ok_or_else(|| "no engine".to_owned())
}

fn bytes<'a>(data: *const u8, len: usize) -> Result<&'a [u8], String> {
	if data.is_null() {
		return Err("no bytes".into());
	}
	Ok(unsafe { std::slice::from_raw_parts(data, len) })
}

fn out(v: Value) -> *mut c_char {
	CString::new(v.to_string()).map_or(std::ptr::null_mut(), CString::into_raw)
}

/// The view a frame is drawn for (`decks_engine_view` in the header).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct DecksView {
	pub x: f64,
	pub y: f64,
	pub zoom: f64,
	pub scale: f64,
	pub width: f64,
	pub height: f64,
}

impl From<DecksView> for View {
	fn from(v: DecksView) -> View {
		View { x: v.x, y: v.y, zoom: v.zoom, scale: v.scale, width: v.width, height: v.height }
	}
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_open(pen: *const c_char, dark: bool, session: *const c_char) -> *mut Engine {
	guard(std::ptr::null_mut(), || Ok(Box::into_raw(Box::new(Engine::new(text(pen, "the drawing")?, dark, text(session, "the session")?)?))))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_close(e: *mut Engine) {
	if !e.is_null() {
		guard((), || {
			drop(unsafe { Box::from_raw(e) });
			Ok(())
		});
	}
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_error() -> *const c_char {
	ERROR.with(|e| e.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_free_string(s: *mut c_char) {
	if !s.is_null() {
		drop(unsafe { CString::from_raw(s) });
	}
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_metal_device(e: *mut Engine) -> *mut c_void {
	guard(std::ptr::null_mut(), || Ok(engine(e)?.device.raw()))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_set_document(e: *mut Engine, pen: *const c_char) -> bool {
	guard(false, || engine(e)?.set_document(text(pen, "the drawing")?).map(|_| true))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_set_dark(e: *mut Engine, dark: bool) -> bool {
	guard(false, || engine(e)?.set_dark(dark).map(|_| true))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_apply_edits(e: *mut Engine, edits: *const c_char) -> bool {
	guard(false, || engine(e)?.apply_edits(text(edits, "the edits")?).map(|_| true))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_apply(e: *mut Engine, changes: *const c_char, mine: bool) -> i64 {
	guard(-1, || engine(e)?.apply(text(changes, "the changes")?, mine).map(|g| g as i64))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_add_font(e: *mut Engine, family: *const c_char, data: *const u8, len: usize, fallback: bool) -> bool {
	guard(false, || {
		engine(e)?.add_font(text(family, "the family")?, bytes(data, len)?.to_vec(), fallback);
		Ok(true)
	})
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_set_cards(e: *mut Engine, cards: *const c_char) -> bool {
	guard(false, || engine(e)?.set_cards(text(cards, "the cards")?).map(|_| true))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_put_picture_pixels(e: *mut Engine, url: *const c_char, rgba: *const u8, len: usize, width: u32, height: u32, stride: u32) -> bool {
	guard(false, || engine(e)?.put_picture_pixels(text(url, "the address")?, bytes(rgba, len)?, width, height, stride).map(|_| true))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_put_picture_texture(e: *mut Engine, url: *const c_char, texture: *mut c_void) -> bool {
	guard(false, || unsafe { engine(e)?.put_picture_texture(text(url, "the address")?, texture) }.map(|_| true))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_put_icon(e: *mut Engine, key: *const c_char, shape: *const c_char) -> bool {
	guard(false, || engine(e)?.put_icon(text(key, "the key")?, text(shape, "the shape")?).map(|_| true))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_attach_layer(e: *mut Engine, layer: *mut c_void, width: u32, height: u32) -> bool {
	guard(false, || {
		if layer.is_null() {
			return Err("no layer".into());
		}
		unsafe { engine(e)?.attach_layer(layer, width, height) }.map(|_| true)
	})
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_frame(e: *mut Engine, view: DecksView) -> i32 {
	guard(-1, || engine(e)?.frame(&view.into()).map(|left| left as i32))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_draw_into(e: *mut Engine, texture: *mut c_void, view: DecksView) -> bool {
	guard(false, || {
		if texture.is_null() {
			return Err("no texture".into());
		}
		unsafe { engine(e)?.draw_into(texture, &view.into()) }.map(|_| true)
	})
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_pick(e: *mut Engine, x: f64, y: f64, slop: f64) -> *mut c_char {
	guard(std::ptr::null_mut(), || Ok(out(engine(e)?.pick(x, y, slop))))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_pick_all(e: *mut Engine, x: f64, y: f64, slop: f64) -> *mut c_char {
	guard(std::ptr::null_mut(), || Ok(out(engine(e)?.pick_all(x, y, slop))))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_within(e: *mut Engine, x: f64, y: f64, w: f64, h: f64) -> *mut c_char {
	guard(std::ptr::null_mut(), || Ok(out(engine(e)?.within(x, y, w, h))))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_layout(e: *mut Engine) -> *mut c_char {
	guard(std::ptr::null_mut(), || Ok(out(engine(e)?.layout())))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_extent(e: *mut Engine) -> *mut c_char {
	guard(std::ptr::null_mut(), || Ok(out(engine(e)?.extent())))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_wanted(e: *mut Engine) -> *mut c_char {
	guard(std::ptr::null_mut(), || Ok(out(engine(e)?.wanted())))
}

#[unsafe(no_mangle)]
pub extern "C" fn decks_engine_font_needs(e: *mut Engine) -> *mut c_char {
	guard(std::ptr::null_mut(), || Ok(out(engine(e)?.font_needs())))
}
