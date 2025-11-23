import { toConsumableArray as _toConsumableArray } from './erase2d-helper.js';;
const { Group } = window.fabric;
import { ClippingGroup } from './erase2d-clipgroup.js';

function walk(objects) {
  return objects.flatMap(function (object) {
    if (!object.erasable || object.isNotVisible()) {
      return [];
    } else if (object instanceof Group && object.erasable === 'deep') {
      return walk(object.getObjects());
    } else {
      return [object];
    }
  });
}
function drawCanvas(ctx, canvas, objects) {
  canvas.clearContext(ctx);
  ctx.imageSmoothingEnabled = canvas.imageSmoothingEnabled;
  ctx.imageSmoothingQuality = 'high';
  // @ts-expect-error node-canvas stuff
  ctx.patternQuality = 'best';
  canvas._renderBackground(ctx);
  ctx.save();
  ctx.transform.apply(ctx, _toConsumableArray(canvas.viewportTransform));
  objects.forEach(function (object) {
    return object.render(ctx);
  });
  ctx.restore();
  var clipPath = canvas.clipPath;
  if (clipPath) {
    // fabric crap
    clipPath._set('canvas', canvas);
    clipPath.shouldCache();
    clipPath._transformDone = true;
    clipPath.renderCache({
      forClipping: true
    });
    canvas.drawClipPathOnCanvas(ctx, clipPath);
  }
  canvas._renderOverlay(ctx);
}

/**
 * Prepare the pattern for the erasing brush
 * This pattern will be drawn on the top context after clipping the main context,
 * achieving a visual effect of erasing only erasable objects.
 *
 * This is designed to support erasing a collection with both erasable and non-erasable objects while maintaining object stacking.\
 * Iterates over collections to allow nested selective erasing.\
 * Prepares objects before rendering the pattern brush.\
 * If brush is **NOT** inverted render all non-erasable objects.\
 * If brush is inverted render all objects, erasable objects without their eraser.
 * This will render the erased parts as if they were not erased in the first place, achieving an undo effect.
 *
 * Caveat:
 * Does not support erasing effects of shadows
 *
 */
function draw(ctx, _ref, _ref2) {
  var inverted = _ref.inverted,
    opacity = _ref.opacity;
  var canvas = _ref2.canvas,
    _ref2$objects = _ref2.objects,
    objects = _ref2$objects === void 0 ? canvas._objectsToRender || canvas._objects : _ref2$objects,
    _ref2$background = _ref2.background,
    background = _ref2$background === void 0 ? canvas.backgroundImage : _ref2$background,
    _ref2$overlay = _ref2.overlay,
    overlay = _ref2$overlay === void 0 ? canvas.overlayImage : _ref2$overlay;
  // prepare tree
  var alpha = 1 - opacity;
  var restore = walk([].concat(_toConsumableArray(objects), _toConsumableArray([background, overlay].filter(function (d) {
    return !!d;
  })))).map(function (object) {
    if (!inverted) {
      var _object$parent;
      //  render only non-erasable objects
      var _opacity = object.opacity;
      object.opacity *= alpha;
      (_object$parent = object.parent) === null || _object$parent === void 0 || _object$parent.set('dirty', true);
      return {
        object: object,
        opacity: _opacity
      };
    } else if (object.clipPath instanceof ClippingGroup) {
      //  render all objects without eraser
      object.clipPath['blockErasing'] = true;
      object.clipPath.set('dirty', true);
      object.set('dirty', true);
      return {
        object: object,
        clipPath: object.clipPath
      };
    }
  });

  // draw
  drawCanvas(ctx, canvas, objects);

  // restore
  restore.forEach(function (entry) {
    if (!entry) {
      return;
    }
    if (entry.opacity) {
      var _entry$object$parent;
      entry.object.opacity = entry.opacity;
      (_entry$object$parent = entry.object.parent) === null || _entry$object$parent === void 0 || _entry$object$parent.set('dirty', true);
    } else if (entry.clipPath) {
      entry.clipPath['blockErasing'] = false;
      entry.clipPath.set('dirty', true);
      entry.object.set('dirty', true);
    }
  });
}

export { draw };
//# sourceMappingURL=ErasingEffect.js.map
