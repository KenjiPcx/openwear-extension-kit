export function cameraConstraints(model) {
  const fps = typeof model.fps === 'number' ? {ideal:model.fps} : model.fps;
  return {
    video: {
      width: {ideal:model.width},
      height: {ideal:model.height},
      frameRate: fps,
      facingMode: 'user',
    },
    audio: false,
  };
}
