import pathlib,json,hashlib,re,subprocess,datetime,html
C=pathlib.Path('/private/tmp/<site-project>-release-gaps-2026-10-13/candidate-current')
E=pathlib.Path('<site-project-repository>/docs/corrections/2026-10-13/indexing-quote-fixes')
R=pathlib.Path('<supervisor-repository>/tmp/<site-project>-independent-export-review')
hash=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
result={'role':'Independent final-export reviewer','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'candidate':str(C),'checks':{},'defects':[]}
def check(name,passed,detail):
 result['checks'][name]={'passed':bool(passed),'detail':detail}
 if not passed:result['defects'].append(name)
def cmd(args,env=None):
 r=subprocess.run(args,cwd=C,capture_output=True,text=True,env=env)
 result.setdefault('commands',[]).append({'argv':args,'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
 return r
head=cmd(['git','rev-parse','HEAD']).stdout.strip()
status=cmd(['git','status','--short']).stdout
check('candidate identity',head=='28efb9d5d5ed3f811a63c365dbee469230dadf4e' and not status,{'head':head,'status':status})
source=json.loads((E/'manifests/reviewed-current-candidate.json').read_text())['inputs']
wrong=[p for p,h in source.items() if not (C/p).is_file() or hash(C/p)!=h]
check('source input manifest',not wrong,{'count':len(source),'mismatches':wrong})
base=json.loads((E/'baseline/current.json').read_text())['files']
preserved=[p for p in base if p.startswith(('src/','messages/','public/','config/'))]
wrong=[p for p in preserved if not (C/p).is_file() or hash(C/p)!=base[p]['sha256']]
check('inherited site content preservation',not wrong,{'count':len(preserved),'mismatches':wrong})
out=C/'out'; ip=out/'.well-known/<site-project>-file-checksums.txt'; manifest=json.loads((out/'.well-known/<site-project>-deployment.json').read_text())
check('export identity',hash(ip)=='c5fc5234003a0b30cc36d77927e5df1e370e80ff0329ecefefdfde863ff113e6' and manifest['sourceSha']==head and manifest['inventory']['sha256']==hash(ip),{'inventorySha256':hash(ip),'manifest':manifest})
entries={}
for line in ip.read_text().splitlines():
 h,p=line.split('  ',1); assert not pathlib.PurePosixPath(p).is_absolute() and '..' not in pathlib.PurePosixPath(p).parts; assert p not in entries; entries[p]=h
wrong=[p for p,h in entries.items() if not (out/p).is_file() or hash(out/p)!=h]
actual={str(p.relative_to(out)) for p in out.rglob('*') if p.is_file()}
excluded={'.well-known/<site-project>-deployment.json','.well-known/<site-project>-file-checksums.txt'}
check('complete export byte inventory',not wrong and actual==set(entries)|excluded,{'count':len(entries),'mismatches':wrong,'extraFiles':sorted(actual-set(entries)-excluded),'missingFiles':sorted(set(entries)-actual)})
r=cmd(['node','scripts/verify-release.mjs']);check('existing release verification',r.returncode==0,r.stdout.strip())
r=cmd(['node','scripts/validate-routes.mjs']);check('existing route verification',r.returncode==0,r.stdout.strip())
routes=json.loads(cmd(['node','-e',"console.log(JSON.stringify(require('./scripts/localized-routes.cjs').localizedPathnames))"]).stdout)
sitemap=(out/'sitemap-0.xml').read_text(); urls=re.findall('<loc>([^<]+)</loc>',sitemap)
rows=[]; failures=[]; ids={'cosmetic','demolition','drywall','flooring','design','not-sure','tile'}
for logical,localized in routes.items():
 expected={lang:'https://www.<site-project-domain>/'+lang+'/'+path.strip('/')+('/' if path!='/' else '') for lang,path in localized.items()};expected['x-default']=expected['it']
 for lang,path in localized.items():
  f=out/lang/path.strip('/')/'index.html'; raw=f.read_text(); static=re.sub(r'<script\b[^>]*>[\s\S]*?</script>','',raw,flags=re.I)
  links=[dict(re.findall(r'([\w-]+)="([^"]*)"',t)) for t in re.findall(r'<link\b[^>]*>',static,re.I)]
  canonical=[x.get('href') for x in links if x.get('rel')=='canonical'];alts={k:[x.get('href') for x in links if x.get('rel')=='alternate' and x.get('hrefLang',x.get('hreflang'))==k] for k in ('it','en','x-default')}
  main=re.search(r'<main\b[^>]*>([\s\S]*?)</main>',static,re.I)
  anchors=[html.unescape(x) for x in re.findall(r'<a\b[^>]*href="([^"]*)"',static,re.I)]
  quote=[x for x in anchors if '/quote' in x and 'service=' in x]
  services=[re.search(r'[?&]service=([^&#]*)',x).group(1) for x in quote]
  ok=canonical==[expected[lang]] and all(alts[k]==[expected[k]] for k in alts) and bool(main and re.search(r'<h1\b[^>]*>.+?</h1>',main[1],re.S)) and ((expected[lang] in urls) == (logical not in ['/cookies','/privacy','/terms'])) and all(s in ids for s in services)
  if not ok:failures.append(str(f))
  rows.append({'logical':logical,'path':str(f.relative_to(out)),'sha256':hash(f),'canonical':canonical,'alternates':alts,'primaryH1':bool(main and re.search(r'<h1\b[^>]*>.+?</h1>',main[1],re.S)),'serviceIds':services,'passed':ok})
check('actual static localized routes',not failures,{'pages':len(rows),'failures':failures})
check('sitemap canonical set',set(urls)=={row['canonical'][0] for row in rows if row['logical'] not in ['/cookies','/privacy','/terms']} and len(urls)==len(set(urls)),{'urls':len(urls),'duplicateCount':len(urls)-len(set(urls))})
r=cmd(['node','--input-type=module','-e',"""import {SERVICE_IDS,resolveQuoteService,normalizeQuoteServiceUrl} from './src/lib/quoteService.ts'; import assert from 'node:assert/strict'; assert.deepEqual([...SERVICE_IDS].sort(),['cosmetic','demolition','drywall','flooring','design','not-sure','tile'].sort()); for(const id of SERVICE_IDS){assert.equal(resolveQuoteService(id),id);assert.equal(resolveQuoteService(id+'/'),null);}const legacy={'Ceramic & Gres Tile Installation':'tile','Drywall & Partition Walls':'drywall','Cosmetic Refreshes':'cosmetic','Light Demolition & Debris Removal':'demolition','Flooring Installation':'flooring','Interior Design & 3D Planning':'design','Not sure — help me figure it out':'not-sure','Posa Piastrelle Ceramica e Gres':'tile','Cartongesso e Pareti Divisorie':'drywall','Rifiniture e Pittura':'cosmetic','Demolizioni e Smaltimento':'demolition','Posa Pavimenti':'flooring','Interior Design e Progettazione 3D':'design','Non sono sicuro — aiutami a capire':'not-sure'};for(const [label,id] of Object.entries(legacy)){assert.equal(resolveQuoteService(label),id);assert.equal(resolveQuoteService(label+'/'),id);const u=new URL('https://www.<site-project-domain>/it/quote/?service='+encodeURIComponent(label+'/')+'&service=design&utm_source=review#fragment');const n=normalizeQuoteServiceUrl(u);assert.deepEqual(n.searchParams.getAll('service'),[id,'design']);assert.equal(n.searchParams.get('utm_source'),'review');assert.equal(n.hash,'#fragment');}console.log('PASS: seven stable IDs, 14 legacy labels with and without one slash; duplicate/query/hash preserved');"""])
check('quote stable and legacy IDs',r.returncode==0,r.stdout.strip())
chunks='\n'.join(p.read_text() for p in (out/'_next/static/chunks').glob('*.js'))
check('generated quote selection implementation',all(('"'+s+'"') in chunks for s in ids) and 'Posa Piastrelle Ceramica e Gres' in chunks and 'Ceramic & Gres Tile Installation' in chunks,{'sevenIdsPresent':all(('"'+s+'"') in chunks for s in ids),'note':'Quote form is a client-rendered Suspense subtree; static primary quote copy exists, interactive form IDs checked in inherited source and compiled chunks. No claim of hydrated form or submission interception.'})
cityFailures=[]
for city,name in {'bologna':'Bologna','casalecchio-di-reno':'Casalecchio di Reno','san-lazzaro-di-savena':'San Lazzaro di Savena','imola':'Imola','valsamoggia':'Valsamoggia'}.items():
 for lang,slug in [('it','servizi'),('en','services')]:
  raw=(out/lang/slug/city/'index.html').read_text()
  if '"areaServed":{"@type":"City","name":"'+name+'"}' not in raw:cityFailures.append(lang+'/'+city)
check('ten city pages scoped schema',not cityFailures,{'failures':cityFailures,'pages':10})
cta=[]
for row in rows:
 expectedService={'/services/ceramic-tile-installation':'tile','/services/drywall-construction':'drywall','/services/light-demolition-debris-removal':'demolition','/guide/sostituzione-piastrelle-bagno-senza-demolizione':'tile'}.get(row['logical'])
 if not expectedService:continue
 raw=(out/row['path']).read_text();static=re.sub(r'<script\b[^>]*>[\s\S]*?</script>','',raw,flags=re.I);main=re.search(r'<main\b[^>]*>([\s\S]*?)</main>',static,re.I)[1]
 anchors=[html.unescape(x) for x in re.findall(r'<a\b[^>]*href="([^"]*)"',main,re.I) if '/quote' in x]
 from urllib.parse import urlparse,parse_qs
 ok=len(anchors)>=3 and len(row['serviceIds'])>=4 and all(x==expectedService for x in row['serviceIds']) and all(urlparse(x).path=='/'+row['path'][:2]+'/quote/' and parse_qs(urlparse(x).query).get('service')==[expectedService] for x in anchors)
 cta.append({'path':row['path'],'expectedService':expectedService,'mainQuoteAnchorCount':len(anchors),'allPrefilledAnchorCount':len(row['serviceIds']),'passed':ok})
check('eight service and guide CTA exports',all(x['passed'] for x in cta) and len(cta)==8,cta)
browser=json.loads((E/'browser/fresh-evidence.json').read_text())
result['reviewedBrowserEvidence']={'sha256':hash(E/'browser/fresh-evidence.json'),'source':browser['frozen_source'],'recordCount':len(browser['records']),'selectionMismatches':browser['selection_mismatches'],'legacyUrlMismatches':browser['legacy_url_mismatches'],'limitations':browser['limitations'],'status':'Reviewed coordinator evidence only; not independently replayed'}
result['pages']=rows
result['finalCandidateStatus']=cmd(['git','status','--short']).stdout
result['privacy']='OPEN / UNAVAILABLE — no collector, provider, runtime modifier-click or submission interception acceptance performed'
result['release']='BLOCKED — export acceptance cannot close privacy/runtime or external/deployment gates'
result['verdict']='PASS' if not result['defects'] else 'PARTIAL'
(R/'evidence.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['verdict','defects','checks']},indent=2))
