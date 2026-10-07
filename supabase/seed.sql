
BEGIN;
INSERT INTO app_user(id,feishu_open_id,display_name,is_platform_admin) VALUES
('10000000-0000-4000-8000-000000000001','platform_admin','平台管理员',true),
('10000000-0000-4000-8000-000000000002','user_a','林知远',false),
('10000000-0000-4000-8000-000000000003','user_b','陈默',false),
('10000000-0000-4000-8000-000000000004','user_c','周宁',false),
('10000000-0000-4000-8000-000000000005','user_d','许晴',false) ON CONFLICT DO NOTHING;
INSERT INTO workspace(id,key,name,description,created_by) VALUES
('20000000-0000-4000-8000-000000000001','alpha','产品研发','产品、工程与持续交付','10000000-0000-4000-8000-000000000001'),
('20000000-0000-4000-8000-000000000002','beta','协作专项','跨团队项目与日常协作','10000000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;
INSERT INTO workspace_member(workspace_id,user_id,role) SELECT w.id,u.id,CASE WHEN u.is_platform_admin THEN 'owner' WHEN u.feishu_open_id='user_a' THEN 'admin' ELSE 'member' END FROM workspace w CROSS JOIN app_user u WHERE u.feishu_open_id IN('platform_admin','user_a','user_b','user_c','user_d') ON CONFLICT DO NOTHING;


INSERT INTO workspace_plugin(workspace_id,plugin_key,enabled_by) VALUES('20000000-0000-4000-8000-000000000001','rnd','10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000001','ops','10000000-0000-4000-8000-000000000001') ON CONFLICT DO NOTHING;
SELECT set_config('app.actor_id','10000000-0000-4000-8000-000000000002',true);
INSERT INTO board(id,workspace_id,key,name,template_key,lane_mode,created_by,intake_enabled) VALUES
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','WORK','日常工作','core.general','none','10000000-0000-4000-8000-000000000002',true),
('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','ALPHA','研发综合','rnd.development','manual','10000000-0000-4000-8000-000000000002',true),
('30000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','BETA','专项协作','core.general','none','10000000-0000-4000-8000-000000000002',true) ON CONFLICT DO NOTHING;
UPDATE board SET plugin_key='rnd' WHERE key='ALPHA';
INSERT INTO board(id,workspace_id,key,name,template_key,plugin_key,lane_mode,created_by,intake_enabled) VALUES('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','OPS','运维响应','ops.operations','ops','manual','10000000-0000-4000-8000-000000000002',true) ON CONFLICT DO NOTHING;
INSERT INTO board_state(id,board_id,key,name,state_group,sort_order,is_initial)
SELECT md5(b.id::text||s.key)::uuid,b.id,s.key,s.name,s.grp,s.ord,s.ord=0 FROM board b CROSS JOIN(VALUES('todo','待处理','unstarted',0),('doing','进行中','started',1),('waiting','等待中','waiting',2),('done','已完成','completed',3),('cancelled','已取消','cancelled',4)) AS s(key,name,grp,ord) ON CONFLICT DO NOTHING;

UPDATE board_state SET name=CASE key WHEN 'todo' THEN '待开发' WHEN 'doing' THEN '开发中' ELSE name END WHERE board_id='30000000-0000-4000-8000-000000000002';
UPDATE board_state SET is_initial=false WHERE board_id='30000000-0000-4000-8000-000000000002';
INSERT INTO board_state(id,board_id,key,name,state_group,sort_order,is_initial) VALUES
(md5('alpha-analysis')::uuid,'30000000-0000-4000-8000-000000000002','analysis','待分析','backlog',-1,true),
(md5('alpha-review')::uuid,'30000000-0000-4000-8000-000000000002','review','评审中','started',2,false),
(md5('alpha-testing')::uuid,'30000000-0000-4000-8000-000000000002','testing','测试中','started',3,false),
(md5('alpha-acceptance')::uuid,'30000000-0000-4000-8000-000000000002','acceptance','验收中','started',4,false) ON CONFLICT DO NOTHING;
DELETE FROM board_state WHERE board_id='30000000-0000-4000-8000-000000000002' AND key='waiting';
UPDATE board_state SET sort_order=6 WHERE board_id='30000000-0000-4000-8000-000000000002' AND key='done';
UPDATE board_state SET sort_order=7 WHERE board_id='30000000-0000-4000-8000-000000000002' AND key='cancelled';
UPDATE board_state SET name=CASE key WHEN 'doing' THEN '处理中' WHEN 'waiting' THEN '观察中' WHEN 'done' THEN '已恢复' WHEN 'cancelled' THEN '已关闭' ELSE name END WHERE board_id='30000000-0000-4000-8000-000000000004';
-- Ops final state is completed; replace the cancelled row before tasks exist.
DELETE FROM board_state WHERE board_id='30000000-0000-4000-8000-000000000004' AND key='cancelled';
INSERT INTO board_state(id,board_id,key,name,state_group,sort_order) VALUES(md5('ops-closed')::uuid,'30000000-0000-4000-8000-000000000004','closed','已关闭','completed',4) ON CONFLICT DO NOTHING;
INSERT INTO board_task_type(id,board_id,key,name,sort_order) SELECT md5(id::text||'task')::uuid,id,'task','任务',0 FROM board ON CONFLICT DO NOTHING;
INSERT INTO board_member(board_id,user_id,role) SELECT id,'10000000-0000-4000-8000-000000000002','lead' FROM board ON CONFLICT DO NOTHING;
INSERT INTO board_lane(id,board_id,key,name,sort_order) VALUES
('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','project-a','项目 A',0),
('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','project-b','项目 B',1),
('40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000002','daily','日常研发',2) ON CONFLICT DO NOTHING;
INSERT INTO task(id,workspace_id,board_id,lane_id,seq,title,type_id,responsible_id,reporter_id,state_id,state_group,priority,due_date,sort_key) VALUES
('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001',1,'统一任务状态与权限校验',md5('30000000-0000-4000-8000-000000000002task')::uuid,'10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',md5('30000000-0000-4000-8000-000000000002doing')::uuid,'started','high','2026-10-09','a0'),
('50000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002',2,'实现跨空间 WIP 并发控制',md5('30000000-0000-4000-8000-000000000002task')::uuid,'10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',md5('30000000-0000-4000-8000-000000000002doing')::uuid,'started','urgent','2026-10-10','a1'),
('50000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000003',NULL,1,'跨团队接口联调',md5('30000000-0000-4000-8000-000000000003task')::uuid,'10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',md5('30000000-0000-4000-8000-000000000003doing')::uuid,'started','medium','2026-10-12','a0') ON CONFLICT DO NOTHING;
INSERT INTO task_participant(task_id,workspace_id,board_id,user_id,added_by)
SELECT t.id,t.workspace_id,t.board_id,u.uid::uuid,t.reporter_id FROM task t JOIN(VALUES('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'),('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004'),('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002'),('50000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000005'))u(tid,uid) ON t.id=u.tid::uuid ON CONFLICT DO NOTHING;
UPDATE board SET task_seq=(SELECT coalesce(max(seq),0) FROM task WHERE board_id=board.id);


INSERT INTO task_focus(task_id,workspace_id,board_id,user_id)
SELECT t.id,t.workspace_id,t.board_id,u.uid::uuid FROM task t JOIN(VALUES('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'),('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002'),('50000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002'),('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003'))u(tid,uid) ON t.id=u.tid::uuid ON CONFLICT DO NOTHING;


INSERT INTO board_task_type(id,board_id,key,name,plugin_key,is_container,sort_order)
SELECT md5('rnd-'||s.key)::uuid,'30000000-0000-4000-8000-000000000002',s.key,s.name,'rnd',s.container,s.ord FROM (VALUES('epic','Epic',true,1),('story','Story',false,2),('bug','Bug',false,3),('subtask','Subtask',false,4))s(key,name,container,ord) ON CONFLICT DO NOTHING;
INSERT INTO board_task_type(id,board_id,key,name,plugin_key,sort_order) VALUES(md5('ops-incident')::uuid,'30000000-0000-4000-8000-000000000004','incident','Incident','ops',1),(md5('ops-maintenance')::uuid,'30000000-0000-4000-8000-000000000004','maintenance','Maintenance','ops',2) ON CONFLICT DO NOTHING;
INSERT INTO rnd_system(id,workspace_id,board_id,name) VALUES('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','工作平台') ON CONFLICT DO NOTHING;
INSERT INTO rnd_module(id,workspace_id,board_id,system_id,name) VALUES('60000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','Core'),('60000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','Web') ON CONFLICT DO NOTHING;
INSERT INTO rnd_task_ext(task_id,workspace_id,board_id,system_id,module_id) SELECT id,workspace_id,board_id,'60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002' FROM task WHERE board_id='30000000-0000-4000-8000-000000000002' ON CONFLICT DO NOTHING;
INSERT INTO rnd_lane_ext(lane_id,workspace_id,board_id,project_code,owner_id,start_date,target_end_date) SELECT l.id,b.workspace_id,l.board_id,upper(l.key),'10000000-0000-4000-8000-000000000002','2026-10-01','2026-10-30' FROM board_lane l JOIN board b ON b.id=l.board_id WHERE b.plugin_key='rnd' ON CONFLICT DO NOTHING;
INSERT INTO ops_service(id,workspace_id,board_id,name) VALUES('60000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004','工作平台 API') ON CONFLICT DO NOTHING;
INSERT INTO task(id,workspace_id,board_id,lane_id,seq,title,type_id,responsible_id,reporter_id,state_id,state_group,priority,due_date,sort_key,description,description_text)
SELECT md5('sample-task-'||s.seq)::uuid,'20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',s.lane::uuid,s.seq,s.title,md5('rnd-'||s.typ)::uuid,s.resp::uuid,'10000000-0000-4000-8000-000000000002',CASE WHEN s.state IN('analysis','review','testing','acceptance') THEN md5('alpha-'||s.state)::uuid ELSE md5('30000000-0000-4000-8000-000000000002'||s.state)::uuid END,bs.state_group,s.prio,s.due::date,'a'||CASE WHEN s.seq<10 THEN chr(48+s.seq) ELSE chr(65+s.seq-10) END,jsonb_build_object('type','doc','content',jsonb_build_array(jsonb_build_object('type','paragraph','content',jsonb_build_array(jsonb_build_object('type','text','text','明确验收标准，记录协作进展。'))))),'明确验收标准，记录协作进展。'
FROM(VALUES
(3,'梳理 Workspace 成员边界','story','10000000-0000-4000-8000-000000000003','analysis','medium','2026-10-15','40000000-0000-4000-8000-000000000001'),
(4,'实现飞书 OAuth 回调与 Session','story','10000000-0000-4000-8000-000000000002','done','high','2026-10-06','40000000-0000-4000-8000-000000000001'),
(5,'修复参与人快速修改的版本冲突','bug','10000000-0000-4000-8000-000000000004','testing','high','2026-10-08','40000000-0000-4000-8000-000000000001'),
(6,'完善移动端任务详情交互','story','10000000-0000-4000-8000-000000000003','todo','medium','2026-10-14','40000000-0000-4000-8000-000000000002'),
(7,'补充跨空间替换的并发测试','subtask','10000000-0000-4000-8000-000000000004','review','high','2026-10-09','40000000-0000-4000-8000-000000000002'),
(8,'检查 Task 软删除后的 Focus 清理','bug','10000000-0000-4000-8000-000000000003','analysis','medium','2026-10-12','40000000-0000-4000-8000-000000000002'),
(9,'整理插件三入口接入说明','story','10000000-0000-4000-8000-000000000005','todo','low','2026-10-16','40000000-0000-4000-8000-000000000003'),
(10,'核对任务父子层级约束','story','10000000-0000-4000-8000-000000000004','doing','medium','2026-10-11','40000000-0000-4000-8000-000000000003'),
(11,'统一筛选器与分组选择器样式','subtask','10000000-0000-4000-8000-000000000003','acceptance','low','2026-10-08','40000000-0000-4000-8000-000000000003'),
(12,'回顾本周工程质量指标','story','10000000-0000-4000-8000-000000000005','done','none','2026-10-05',NULL)
)s(seq,title,typ,resp,state,prio,due,lane) JOIN board_state bs ON bs.board_id='30000000-0000-4000-8000-000000000002' AND bs.key=s.state ON CONFLICT DO NOTHING;
UPDATE board SET task_seq=(SELECT coalesce(max(seq),0) FROM task WHERE board_id=board.id);
COMMIT;
