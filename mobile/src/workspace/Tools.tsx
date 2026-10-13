import React, {useEffect, useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {
  createResume,
  getJobs,
  getResumes,
  runTool,
  type Job,
  type ResumeVersion,
  type ToolKind,
} from '../api/workspace';
import {
  AnswerText,
  Button,
  Field,
  Notice,
  Select,
  Txt,
  ui,
  usePalette,
} from './ui';
const tools = [
  {
    value: 'intro',
    label: '自我介绍',
    description: '把岗位和个人经历组织成开场表达',
  },
  {
    value: 'project',
    label: '项目梳理',
    description: '讲清背景、责任、难点与结果',
  },
  {value: 'jd', label: '岗位分析', description: '找出能力要求与准备重点'},
  {value: 'answer', label: '回答练习', description: '提前准备问题、原理与例子'},
];
export default function Tools() {
  const t = usePalette();
  const [tool, setTool] = useState('intro'),
    [input, setInput] = useState(''),
    [role, setRole] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]),
    [resumes, setResumes] = useState<ResumeVersion[]>([]),
    [job, setJob] = useState(''),
    [resume, setResume] = useState('');
  const [text, setText] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    Promise.all([getJobs(), getResumes()])
      .then(([j, r]) => {
        setJobs(j);
        setResumes(r);
      })
      .catch(e => setNotice(e.message));
    return () => abort.current?.abort();
  }, []);
  const run = async () => {
    if (busy) {
      return;
    }
    if (!input.trim()) {
      setNotice('请先填写准备内容');
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setText('');
    setNotice('');
    try {
      const j = jobs.find(v => v.id === job);
      await runTool(
        tool as ToolKind,
        {
          input,
          role: j?.title || role,
          job_description: j?.description || '',
          resume_text: resumes.find(v => v.id === resume)?.text || '',
        },
        setText,
        controller.signal,
      );
    } catch (e) {
      setNotice(
        controller.signal.aborted
          ? '已停止，保留部分内容'
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };
  return (
    <View style={ui.fill}>
      <View style={[ui.header, {borderColor: t.divider}]}>
        <Text style={[ui.title, {color: t.textPrimary}]}>面试准备</Text>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={ui.page}>
        {!busy && (
          <>
            <Select
              label="准备什么"
              value={tool}
              options={tools}
              onChange={setTool}
            />
            <Select
              label="目标岗位"
              value={job}
              options={[
                {value: '', label: '临时填写'},
                ...jobs.map(j => ({value: j.id, label: j.title})),
              ]}
              onChange={setJob}
            />
            {!job && (
              <Field
                label="岗位名称（选填）"
                value={role}
                onChangeText={setRole}
              />
            )}
            <Select
              label="关联真实资料"
              value={resume}
              options={[
                {value: '', label: '不关联资料'},
                ...resumes.map(r => ({
                  value: r.id,
                  label: `${r.filename} · v${r.version}`,
                })),
              ]}
              onChange={setResume}
            />
            <Field
              label="准备内容"
              multiline
              value={input}
              onChangeText={v => {
                setInput(v);
                setNotice('');
              }}
              placeholder={
                tool === 'jd'
                  ? '粘贴岗位要求'
                  : tool === 'answer'
                  ? '输入你想练习的问题'
                  : '填写你的经历、重点或希望突出的问题'
              }
              error={
                !input.trim() && notice.includes('填写') ? notice : undefined
              }
            />
          </>
        )}
        {busy ? (
          <Button
            tone="quiet"
            label="停止生成"
            onPress={() => abort.current?.abort()}
          />
        ) : (
          <Button label={text ? '重新生成' : '开始准备'} onPress={run} />
        )}
        <Notice text={notice} />
        {busy && !text && (
          <Button label="正在组织内容…" busy onPress={() => {}} />
        )}
        {!!text && (
          <View
            style={[
              ui.card,
              {borderColor: t.divider, backgroundColor: t.bgSurface},
            ]}>
            <Txt muted small>
              准备草稿 · 使用前请核实
            </Txt>
            <AnswerText text={text} />
            {!busy && (
              <Button
                tone="quiet"
                label="保存到准备草稿"
                busy={saving}
                onPress={async () => {
                  setSaving(true);
                  try {
                    await createResume(
                      text,
                      `准备草稿 · ${tools.find(v => v.value === tool)?.label}`,
                      'draft',
                    );
                    setNotice('已保存到资料中的准备草稿');
                  } catch (e) {
                    setNotice((e as Error).message);
                  } finally {
                    setSaving(false);
                  }
                }}
              />
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
