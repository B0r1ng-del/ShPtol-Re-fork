from PIL import Image, ImageChops
import numpy as np
D='H:/卫戍协议盟约/game/docs/'
a=Image.open(D+'before-sweep.png').convert('RGB')
b=Image.open(D+'after-sweep.png').convert('RGB')
print('sizes', a.size, b.size)
if a.size!=b.size:
    b=b.resize(a.size)
na=np.asarray(a).astype(np.int16); nb=np.asarray(b).astype(np.int16)
diff=np.abs(na-nb).max(axis=2)
print('changed px (>12):', int((diff>12).sum()), '/', diff.size, '= %.2f%%' % ((diff>12).mean()*100))
# 左半区（助理立绘区域）
half=diff[:, :500]
print('left half changed (>12): %.2f%%' % ((half>12).mean()*100))
ys,xs=np.where(diff>12)
if len(xs): print('bbox of change:', xs.min(), ys.min(), xs.max(), ys.max())
Image.fromarray((np.clip(diff*4,0,255)).astype('uint8')).save(D+'diff-sweep.png')
