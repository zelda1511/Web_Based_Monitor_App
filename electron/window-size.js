// The window opens at its normal size, but never bigger than the screen's work area (a 1080p laptop at 150% scale has only about 1280x672
// to use), and its minimum size is cut down the same way so the window can always be reached and resized.
function fitWindow({ width, height, minWidth, minHeight }, workArea) {
  const w = Math.max(1, Math.floor(workArea?.width ?? width));
  const h = Math.max(1, Math.floor(workArea?.height ?? height));
  return {
    width: Math.min(width, w),
    height: Math.min(height, h),
    minWidth: Math.min(minWidth, w),
    minHeight: Math.min(minHeight, h),
  };
}

module.exports = { fitWindow };
