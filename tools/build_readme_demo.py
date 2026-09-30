from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import argparse, json, math
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description='Build a README GIF from actual application captures.')
parser.add_argument('--language', choices=('ja', 'en'), default='ja')
args=parser.parse_args()
english=args.language=='en'
suffix='-en' if english else ''
WORK=ROOT/('output/readme-demo'+suffix)
OUT=ROOT/'docs/media'
OUT.mkdir(parents=True,exist_ok=True)
shots=json.loads((WORK/'timeline.json').read_text(encoding='utf-8'))
# Arrange actual EXE captures in a compact walkthrough. Chooser dialogs are omitted.
order=[0,1,27,28,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26]
W,H,TOP,SCREEN_H=1280,874,76,760
FONT='C:/Windows/Fonts/meiryo.ttc';BOLD='C:/Windows/Fonts/meiryob.ttc'
font=ImageFont.truetype(FONT,26);small=ImageFont.truetype(FONT,15);bold=ImageFont.truetype(BOLD,28)
frames=[];durations=[];review=[]

def crop_for(idx,im):
 w,h=im.size
 # Camera zooms keep small text readable; no UI or outcomes are fabricated.
 if idx in (7,8,9,11,12):
  cw,ch=min(w,860),min(h,510);cx,cy=w/2,h/2
 elif idx in (13,14,15,16,17,18):
  cw,ch=min(w,1020),min(h,606);cx,cy=w/2,h/2
 elif idx in (2,3,4,5,6,21,24,25,26):
  cw,ch=w*.78,h*.78;cx,cy=w-cw/2,h/2
 else:return (0,0,w,h)
 x=max(0,min(w-cw,cx-cw/2));y=max(0,min(h-ch,cy-ch/2))
 if english and idx in (2,3,4,5,6,21,24,25,26):y=56
 return(x,y,x+cw,y+ch)

def compose(idx,shot,zoom=1,pulse=0,progress=0):
 im=Image.open(WORK/'frames'/shot['file']).convert('RGB');iw,ih=im.size
 target=crop_for(idx,im)
 box=tuple(a+(b-a)*zoom for a,b in zip((0,0,iw,ih),target))
 shotim=im.crop(tuple(round(v) for v in box)).resize((W,SCREEN_H),Image.Resampling.LANCZOS)
 canvas=Image.new('RGB',(W,H),'#f2f6f8');canvas.paste(shotim,(0,TOP));d=ImageDraw.Draw(canvas)
 d.rectangle((0,0,W,TOP),fill='#173544');d.rounded_rectangle((20,21,53,54),radius=8,fill='#2f9296');d.text((29,23),'▶',font=small,fill='white')
 label=shot['label'];d.text((68,20),label,font=bold,fill='white')
 d.rectangle((0,TOP+SCREEN_H,W,H),fill='#173544');d.text((20,H-29),'PrepFlow Viewer  |  Windows walkthrough' if english else 'PrepFlow Viewer  |  Windows版 操作デモ',font=small,fill='#d6e6ed')
 d.text((958,H-29),'Explore · Edit · Share' if english else '見る・編集する・共有する',font=small,fill='#d6e6ed')
 d.rectangle((0,H-4,int(W*progress),H),fill='#39b4ab')
 r=shot.get('rect')
 if r and r['width']<240 and r['height']<140 and pulse:
  sx=W/(box[2]-box[0]);sy=SCREEN_H/(box[3]-box[1]);x=(r['x']+r['width']/2-box[0])*sx;y=TOP+(r['y']+r['height']/2-box[1])*sy
  if 8<x<W-8 and TOP+8<y<TOP+SCREEN_H-8:
   radius=15+pulse*6;d.ellipse((x-radius,y-radius,x+radius,y+radius),outline='#f39b47',width=3)
   d.polygon([(x,y),(x+5,y+23),(x+10,y+16),(x+19,y+16)],fill='white',outline='#183746',width=2)
 return canvas

# A readable opening poster, backed by a real EXE frame.
poster=compose(1,shots[1],0,0,0)
overlay=Image.new('RGBA',poster.size,(0,0,0,0));od=ImageDraw.Draw(overlay)
od.rounded_rectangle((100,220,1180,532),radius=20,fill=(21,51,65,242))
od.text((152,254),'PrepFlow Viewer',font=ImageFont.truetype(BOLD,34),fill='#6fe0d0')
od.text((152,314),'Understand your flow at a glance.' if english else 'フローを瞬時に把握する。',font=ImageFont.truetype(BOLD,43 if english else 54),fill='white')
od.text((155,405),'Explore, edit and share — in one walkthrough.' if english else '閲覧から編集・HTML共有まで、主要操作を1本で。',font=ImageFont.truetype(FONT,26),fill='#e1edf1')
od.text((155,460),'Inspect your flow without loading source data.' if english else 'データの読み込みなしで、フローの中身を確認。',font=ImageFont.truetype(FONT,24),fill='#c0d7df')
poster=Image.alpha_composite(poster.convert('RGBA'),overlay).convert('RGB');poster.save(OUT/f'readme-demo{suffix}-poster.png')
frames.append(poster);durations.append(1900)
for pos,idx in enumerate(order):
 shot=shots[idx];duration=int(shot['seconds']*1000);progress=(pos+1)/len(order)
 if idx==0:duration=900
 for z in (0,.38,.76,1):
  frames.append(compose(idx,shot,z,0,progress));durations.append(70)
 # The cursor halo identifies the real control being used in this step.
 for pulse in (1,2,1):frames.append(compose(idx,shot,1,pulse,progress));durations.append(100)
 still=compose(idx,shot,1,0,progress);frames.append(still);durations.append(max(600,duration-580));review.append((idx,still))
frames.append(poster);durations.append(1500)
# Fixed palette avoids color flicker, and GIF delta frames keep repository size modest.
thumb=Image.new('RGB',(320*6,219*5),'white')
for i,im in enumerate(frames[::8][:30]):thumb.paste(im.resize((320,219)),((i%6)*320,(i//6)*219))
palette=thumb.quantize(colors=192,method=Image.Quantize.MEDIANCUT)
quantized=[im.quantize(palette=palette,dither=Image.Dither.NONE) for im in frames]
quantized[0].save(OUT/f'readme-demo{suffix}.gif',save_all=True,append_images=quantized[1:],duration=durations,loop=0,optimize=True,disposal=1)
for group in range(math.ceil(len(review)/6)):
 sheet=Image.new('RGB',(1280,3*455),'#e4ecef')
 for j,(idx,im) in enumerate(review[group*6:group*6+6]):
  sheet.paste(im.resize((640,437)),((j%2)*640,(j//2)*455))
 sheet.save(WORK/f'final-review-{group}.jpg')
info={'durationSeconds':sum(durations)/1000,'sizeBytes':(OUT/f'readme-demo{suffix}.gif').stat().st_size,'width':W,'height':H,'sourceCaptures':len(shots),'animatedFrames':len(frames)}
(WORK/'result.json').write_text(json.dumps(info,indent=2),encoding='utf-8');print(json.dumps(info))
