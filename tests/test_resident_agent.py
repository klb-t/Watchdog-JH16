import contextlib, hashlib, importlib, io, json, os, pathlib, subprocess, sys, tempfile, unittest, zipfile
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'tools/resident_agent'))
import agentctl as a
import review
import cloud

class TestResident(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name)/'agent';self.old=a.ROOT;a.ROOT=self.root
 def tearDown(self):a.ROOT=self.old;self.tmp.cleanup()
 def test_init_preserves_settings(self):
  a.init();p=self.root/'settings.json';p.write_text('{"custom": true}');a.init();self.assertEqual(json.loads(p.read_text()),{'custom':True})
 def test_preferences_preserved(self):
  a.init();p=self.root/'workspace/OWNER_PREFERENCES.md';p.write_text('mine');a.init();self.assertEqual(p.read_text(),'mine')
 def test_unmanaged_refused(self):
  self.root.mkdir();(self.root/'keep').write_text('x')
  with self.assertRaises(RuntimeError):a.init()
 def test_symlink_root_refused(self):
  other=self.root.parent/'other';other.mkdir();self.root.symlink_to(other)
  with self.assertRaises(RuntimeError):a.init()
 def test_symlink_file_refused(self):
  a.init();p=self.root/'state/link';p.symlink_to('/nonexistent')
  with self.assertRaises(RuntimeError):a.write(p,'x',True)
 def test_queue_idempotence(self):
  a.queue_task('original','hello');a.queue_task('different','hello');self.assertEqual(json.loads((self.root/'queue/hello.json').read_text())['prompt'],'original')
 def test_bad_queue_id(self):
  with self.assertRaises(ValueError):a.queue_task('hi','../bad')
 def test_interrupted_not_replayed(self):
  a.queue_task('hi','first');p=self.root/'queue/first.json';t=json.loads(p.read_text());t['state']='running';p.write_text(json.dumps(t))
  with patch.object(a,'codex_job') as job:a.worker(True);job.assert_not_called()
  self.assertEqual(a.status()[0]['state'],'needs-review')
 def test_failed_job_not_repeated(self):
  a.queue_task('hi','first')
  with patch.object(a,'codex_job',return_value=('needs-review','limit')) as job:
   a.worker(True);a.worker(True);self.assertEqual(job.call_count,1)
 def test_completed_status(self):
  a.queue_task('hi','first')
  with patch.object(a,'codex_job',return_value=('completed','codex_exit_0')):a.worker(True)
  self.assertEqual(a.status()[0]['state'],'completed')
 def test_lease_off_does_not_touch(self):
  a.init();cfg=a.config();cfg['lease_dir']=str(self.root/'leases');pathlib.Path(cfg['lease_dir']).mkdir();a.write(self.root/'settings.json',a.jbytes(cfg),True)
  with a.lease() as tick:tick();self.assertEqual(list(pathlib.Path(cfg['lease_dir']).iterdir()),[])
 def test_enabled_lease_removed(self):
  a.init();cfg=a.config();cfg['lease_dir']=str(self.root/'leases');cfg['idle_integration_verified']=True;pathlib.Path(cfg['lease_dir']).mkdir();a.write(self.root/'settings.json',a.jbytes(cfg),True)
  with a.lease() as tick:tick();self.assertEqual(len(list(pathlib.Path(cfg['lease_dir']).iterdir())),1)
  self.assertEqual(list(pathlib.Path(cfg['lease_dir']).iterdir()),[])
 def archive(self,convs):
  p=self.root.parent/'input.zip'
  with zipfile.ZipFile(p,'w') as z:z.writestr('folder/conversations-001.json',json.dumps(convs));z.writestr('../not-extracted.sh','evil')
  return p
 def test_scan_both_formats_full_branches(self):
  c=[{'uuid':'claude','name':'p','chat_messages':[{'uuid':'a','sender':'human','text':'agent piczujący'}]},
   {'id':'openai','title':'branch','mapping':{'one':{'message':{'id':'x','author':{'role':'user'},'content':{'parts':['agent scientific']}}},'two':{'message':{'id':'y','author':{'role':'assistant'},'content':{'parts':['alternate branch']}}}}}]
  result=a.scan([self.archive(c)]);self.assertEqual(result['unique_candidates'],2)
  raw=list((self.root/'analysis/corpus').glob('*.raw.json'));self.assertEqual(len(raw),2)
  self.assertFalse((self.root.parent/'not-extracted.sh').exists())
  self.assertTrue(any('alternate branch' in p.read_text() for p in raw))
 def test_no_agent_pitch_supplement(self):
  c=[{'uuid':'1','name':'Awatar portfolio','chat_messages':[]},{'uuid':'2','name':'unrelated','chat_messages':[]}]
  self.assertEqual(a.scan([self.archive(c)])['unique_candidates'],1)
 def test_attachment_only_hit(self):
  c=[{'uuid':'1','chat_messages':[{'uuid':'a','sender':'human','attachments':[{'extracted_content':'pitching agent'}]}]}]
  self.assertEqual(a.scan([self.archive(c)])['unique_candidates'],1)
 def test_missing_source_not_complete(self):
  self.assertEqual(a.scan([self.root/'absent.zip'])['sources'][0]['state'],'missing')
 def test_chunks_lossless(self):
  text='Zażółć gęślą jaźń. '*1200;parts=list(review.chunks([{'id':'a','role':'human','text':text}],limit=4000))
  self.assertGreater(len(parts),1);self.assertEqual(''.join(m['text'] for p in parts for m in p),text)
 def test_models_do_not_substitute_missing_astra(self):
  self.assertIsNone(review.choose([{'model':'small-luna'}])['deep_model'])
 def test_models_highest_supported_effort(self):
  c=review.choose([{'model':'test-astra','supportedReasoningEfforts':[{'reasoningEffort':'low'},{'reasoningEffort':'high'}]}])
  self.assertEqual(c['deep_effort'],'high');self.assertIsNone(c['cheap_model'])
 def test_archive_dedup_preserves_provenance(self):
  p=self.archive([{'uuid':'x','name':'agent','chat_messages':[]}]);r=a.scan([p,p]);self.assertEqual(r['unique_candidates'],1);self.assertEqual(r['candidate_rows'],2)
 def test_actual_exec_with_fake_cli(self):
  a.init();bindir=self.root/'fake';bindir.mkdir();cli=bindir/'codex'
  cli.write_text('#!/usr/bin/env python3\nimport sys,pathlib,json\nsys.stdin.read()\np=pathlib.Path(sys.argv[sys.argv.index("--output-last-message")+1]);p.write_text("done")\nprint(json.dumps({"argv":sys.argv[1:]}))\n');cli.chmod(0o700)
  a.queue_task('test','fake')
  with patch.dict(os.environ,{'PATH':str(bindir)+os.pathsep+os.environ['PATH']}),patch('agentctl.time.sleep'):a.worker(True)
  self.assertEqual(a.status()[0]['state'],'completed')
  argv=json.loads((self.root/'runs/fake/events.jsonl').read_text())['argv'];self.assertIn('workspace-write',argv);self.assertNotIn('danger-full-access',argv)

class TestDownload(unittest.TestCase):
 def do(self,part,response,status):
  tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);dest=pathlib.Path(tmp.name)/'a.zip';dest.with_suffix('.part').write_bytes(part)
  whole=b'abcdef';meta={'size':'6','md5Checksum':hashlib.md5(whole).hexdigest()}
  class Resp(io.BytesIO):pass
  r=Resp(response);r.status=status;r.headers={'Content-Range':f'bytes {len(part)}-5/6'}
  with patch.object(cloud,'meta',return_value=meta),patch.object(cloud,'token',return_value='fake'),patch('cloud.urllib.request.urlopen',return_value=r):cloud.download('fake',dest)
  return dest.read_bytes()
 def test_partial_206(self):self.assertEqual(self.do(b'abc',b'def',206),b'abcdef')
 def test_ignored_range_restarts_not_appends(self):self.assertEqual(self.do(b'abc',b'abcdef',200),b'abcdef')
 def test_corruption_rejected(self):
  with self.assertRaises(RuntimeError):self.do(b'abc',b'xyz',206)

if __name__=='__main__':unittest.main()
