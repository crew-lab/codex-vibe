import asyncio,importlib.util,json,os,sys,time,socket,resource,statistics
from pathlib import Path
start=time.perf_counter()
def refuse_network(*a,**k):raise RuntimeError('Network disabled in local performance probe')
socket.socket.connect=refuse_network
socket.create_connection=refuse_network
import vibe
assert vibe.__version__=='2.26.1'
root=Path(sys.argv[1]);shim=sys.argv[2];variant=sys.argv[3]
s=importlib.util.spec_from_file_location('bench_shim',shim);launcher=importlib.util.module_from_spec(s);s.loader.exec_module(launcher)
launcher._patch_project_discovery()
rec=launcher.WorkerDiagnostics(str(root.parent/'diagnostics')) if variant=='diagnostics' else None
patch_ms=0
if variant!='baseline':
 t=time.perf_counter();launcher._patch_tool_diagnostics(rec);patch_ms=(time.perf_counter()-t)*1000
from vibe.core.agents.manager import AgentManager
from vibe.core.config.harness_files import HarnessFilesManager,init_harness_files_manager
from vibe.core.config.layers.default import DefaultConfigLayer
from vibe.core.config.layers.environment import EnvironmentLayer
from vibe.core.config.layers.agent_profile import AgentProfileLayer
from vibe.core.config.orchestrator import ConfigOrchestrator
from vibe.core.config.vibe_schema import VibeConfigSchema
from vibe.core.tools.manager import ToolManager
from vibe.core.tools.permissions import ToolPermission
async def main():
 init_harness_files_manager('user','project')
 class Trust:
  def is_trusted(self,p):return True
 harness=HarnessFilesManager(sources=('user','project'),cwd=root,trust_store=Trust())
 defaults=DefaultConfigLayer(schema=VibeConfigSchema)
 orch=await ConfigOrchestrator.create(schema=VibeConfigSchema,layers=[defaults,EnvironmentLayer(schema=VibeConfigSchema),AgentProfileLayer()],default_layer_resolver=lambda:defaults)
 manager=AgentManager(orch,initial_agent=os.environ['VIBE_DEFAULT_AGENT'],harness_files=harness)
 config=manager.config;tools=ToolManager(lambda:config,defer_mcp=True,cwd=root,harness_files=harness)
 expected={'read_file','grep'} | ({'write_file','edit'} if os.environ['VIBE_DEFAULT_AGENT']=='accept-edits' else set())
 assert set(tools.available_tools)==expected
 ready_ms=(time.perf_counter()-start)*1000
 n=10000;t=time.perf_counter()
 for i in range(n):assert set(tools.available_tools)==expected
 inventory_us=(time.perf_counter()-t)*1e6/n
 tool=tools.get('read_file');latencies=[]
 for i in range(100):
  target=str(root/'.github/workflows/rollback.yml');args=tool.validate_arguments({'file_path':target});decision=tool.resolve_permission(args)
  assert (decision.permission if decision else tool.config.permission)==ToolPermission.ALWAYS
  t=time.perf_counter();chunks=[x async for x in tool.invoke(file_path=target)];latencies.append((time.perf_counter()-t)*1000)
  assert 'local-benchmark' in next(x for x in chunks if hasattr(x,'content')).content
 ticks=[];size=0
 if rec:
  for i in range(100):
   t=time.perf_counter();rec.tick();ticks.append((time.perf_counter()-t)*1000)
  launcher._finish_diagnostics(rec);data=json.loads((root.parent/'diagnostics/worker-diagnostics.json').read_text());size=(root.parent/'diagnostics/worker-diagnostics.json').stat().st_size
  assert set(data['tool_inventory'])==expected and len(data['tool_calls'])==200
 print(json.dumps({'variant':variant,'mode':os.environ['VIBE_DEFAULT_AGENT'],'ready_ms':ready_ms,'patch_ms':patch_ms,'inventory_us':inventory_us,'read_median_ms':statistics.median(latencies),'read_p95_ms':sorted(latencies)[94],'tick_median_ms':statistics.median(ticks) if ticks else None,'diagnostic_bytes':size,'max_rss_bytes_macos':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,'successful_reads':100,'provider_requests':0}))
asyncio.run(main())
