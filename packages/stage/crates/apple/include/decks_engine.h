/*
 * The drawing engine for Apple platforms (stage-apple). Rules: crates/apple/README.md.
 * Strings are UTF-8. A call that fails returns false, -1 or NULL; decks_engine_error() says why.
 * Strings returned are JSON, freed with decks_engine_free_string. One thread per engine.
 */
#ifndef DECKS_ENGINE_H
#define DECKS_ENGINE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct Engine DecksEngine;

/* Where the stage is looking: the stage point at the view's top left, points per stage unit,
   pixels per point, and the view's size in points. */
typedef struct DecksView {
	double x, y, zoom, scale, width, height;
} DecksView;

/* Open an engine on the system's Metal device, for a drawing (.pen text), a scheme, a session. */
DecksEngine *decks_engine_open(const char *pen, bool dark, const char *session);
void decks_engine_close(DecksEngine *engine);
const char *decks_engine_error(void);
void decks_engine_free_string(char *json);
/* The engine's MTLDevice (not retained): make the textures you hand in or draw into on it. */
void *decks_engine_metal_device(DecksEngine *engine);

/* The document: whole, the server's edits (stage.pen.delta edits), this session's changes. */
bool decks_engine_set_document(DecksEngine *engine, const char *pen);
bool decks_engine_set_dark(DecksEngine *engine, bool dark);
bool decks_engine_apply_edits(DecksEngine *engine, const char *edits_json);
/* Returns the batch's generation, or -1. */
int64_t decks_engine_apply(DecksEngine *engine, const char *changes_json, bool mine);

/* What the drawing needs: fonts, cards' places, pictures (RGBA8 premultiplied) and icons. */
bool decks_engine_add_font(DecksEngine *engine, const char *family, const uint8_t *bytes, size_t length, bool fallback);
bool decks_engine_set_cards(DecksEngine *engine, const char *cards_json);
bool decks_engine_put_picture_pixels(DecksEngine *engine, const char *url, const uint8_t *rgba, size_t length, uint32_t width, uint32_t height, uint32_t stride);
/* An MTLTexture made on decks_engine_metal_device, RGBA8Unorm, 2D, one level. */
bool decks_engine_put_picture_texture(DecksEngine *engine, const char *url, void *mtl_texture);
bool decks_engine_put_icon(DecksEngine *engine, const char *key, const char *shape_json);

/* Frames. attach_layer takes a CAMetalLayer; frame paints a few tiles and draws into it, and
   returns how many tiles the view still needs (above 0: draw another frame soon), or -1.
   draw_into draws the view whole into an RGBA8Unorm MTLTexture and waits until it is done. */
bool decks_engine_attach_layer(DecksEngine *engine, void *ca_metal_layer, uint32_t width, uint32_t height);
int32_t decks_engine_frame(DecksEngine *engine, DecksView view);
bool decks_engine_draw_into(DecksEngine *engine, void *mtl_texture, DecksView view);

/* Questions, answered as JSON. Points are in stage units. */
char *decks_engine_pick(DecksEngine *engine, double x, double y, double slop);
char *decks_engine_pick_all(DecksEngine *engine, double x, double y, double slop);
char *decks_engine_within(DecksEngine *engine, double x, double y, double width, double height);
char *decks_engine_layout(DecksEngine *engine);
char *decks_engine_extent(DecksEngine *engine);
char *decks_engine_wanted(DecksEngine *engine);
char *decks_engine_font_needs(DecksEngine *engine);

#ifdef __cplusplus
}
#endif

#endif
