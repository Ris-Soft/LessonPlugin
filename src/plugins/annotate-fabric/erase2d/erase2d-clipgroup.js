import { defineProperty as _defineProperty, inherits as _inherits, createClass as _createClass, classCallCheck as _classCallCheck, callSuper as _callSuper, objectSpread2 as _objectSpread2, assertThisInitialized as _assertThisInitialized } from './erase2d-helper.js';;
const { classRegistry, LayoutManager, FixedLayout, Path, Group } = window.fabric;

var ClippingGroup = /*#__PURE__*/function (_Group) {
  _inherits(ClippingGroup, _Group);
  function ClippingGroup(objects, options) {
    var _this;
    _classCallCheck(this, ClippingGroup);
    _this = _callSuper(this, ClippingGroup, [objects, _objectSpread2({
      originX: 'center',
      originY: 'center',
      left: 0,
      top: 0,
      layoutManager: new LayoutManager(new FixedLayout())
    }, options)]);
    _defineProperty(_assertThisInitialized(_this), "blockErasing", false);
    return _this;
  }
  _createClass(ClippingGroup, [{
    key: "drawObject",
    value: function drawObject(ctx) {
      var paths = [];
      var objects = [];
      this._objects.forEach(function (object) {
        return (object instanceof Path ? paths : objects).push(object);
      });
      ctx.save();
      ctx.fillStyle = 'black';
      ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
      ctx.restore();
      !this.blockErasing && paths.forEach(function (path) {
        path.render(ctx);
      });
      objects.forEach(function (object) {
        object.globalCompositeOperation = object.inverted ? 'destination-out' : 'source-in';
        object.render(ctx);
      });
    }
  }]);
  return ClippingGroup;
}(Group);
_defineProperty(ClippingGroup, "type", 'clipping');
classRegistry.setClass(ClippingGroup);

export { ClippingGroup };
//# sourceMappingURL=ClippingGroup.js.map
