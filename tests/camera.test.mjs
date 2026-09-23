import test from 'node:test';
import assert from 'node:assert/strict';
import {cameraConstraints} from '../src/camera.js';

test('preserves the SDK frame-rate constraint object',()=>{
  const constraints=cameraConstraints({width:1280,height:720,fps:{ideal:30,max:30}});
  assert.deepEqual(constraints.video.frameRate,{ideal:30,max:30});
  assert.equal(Number.isFinite(constraints.video.frameRate.ideal),true);
});

test('wraps a numeric frame rate as an ideal constraint',()=>{
  assert.deepEqual(cameraConstraints({width:1280,height:720,fps:25}).video.frameRate,{ideal:25});
});
