import React, {useEffect, useState} from 'react';
import {Alert, ScrollView, Text, View} from 'react-native';
import {
  createJob,
  createResume,
  deleteJob,
  getJobs,
  getResumes,
  updateJob,
  uploadResumeVersion,
  type Job,
  type ResumeVersion,
} from '../api/workspace';
import {AudioCapture} from '../native';
import {
  Button,
  Empty,
  Field,
  Notice,
  Segments,
  Select,
  Txt,
  ui,
  usePalette,
} from './ui';

export default function Library() {
  const t = usePalette();
  const [tab, setTab] = useState('jobs');
  const [jobs, setJobs] = useState<Job[]>([]),
    [resumes, setResumes] = useState<ResumeVersion[]>([]);
  const [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(''),
    [company, setCompany] = useState(''),
    [text, setText] = useState('');
  const [kind, setKind] = useState<'resume' | 'experience' | 'draft'>('resume'),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const load = async () => {
    setBusy(true);
    try {
      const [j, r] = await Promise.all([getJobs(), getResumes(true)]);
      setJobs(j);
      setResumes(r);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  const begin = (id = 'new') => {
    setNotice('');
    setEditing(id);
    const item =
      tab === 'jobs'
        ? jobs.find(j => j.id === id)
        : resumes.find(r => r.id === id);
    setName(item ? ('title' in item ? item.title : item.filename) : '');
    setCompany(item && 'company' in item ? item.company : '');
    setText(item ? ('text' in item ? item.text : item.description) : '');
    setKind(item && 'kind' in item ? item.kind || 'resume' : 'resume');
  };
  const save = async () => {
    if (!name.trim() || !text.trim()) {
      setNotice('请填写名称和内容');
      return;
    }
    setBusy(true);
    try {
      if (tab === 'jobs') {
        const data = {
          title: name.trim(),
          company: company.trim(),
          description: text.trim(),
        };
        if (editing === 'new') {
          await createJob(data);
        } else {
          await updateJob(editing!, data);
        }
      } else {
        await createResume(text.trim(), name.trim(), kind);
      }
      setEditing(null);
      await load();
      setNotice(
        tab === 'jobs' ? '岗位已保存' : '资料已保存为新版本，历史面试资料不变',
      );
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const upload = async () => {
    setBusy(true);
    setNotice('');
    try {
      const file = await AudioCapture.pickDocument([
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
      ]);
      if (!file) {
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('文件不能超过 10 MB');
      }
      await uploadResumeVersion(file);
      await load();
      setNotice('简历已导入，请打开检查解析内容');
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={ui.fill}>
      <View style={[ui.header, {borderColor: t.divider, gap: 12}]}>
        <Text style={[ui.title, {color: t.textPrimary}]}>
          {editing ? '编辑资料' : '岗位与资料'}
        </Text>
        {!editing && (
          <Segments
            value={tab}
            onChange={setTab}
            options={[
              {value: 'jobs', label: '目标岗位'},
              {value: 'resumes', label: '我的资料'},
            ]}
          />
        )}
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={ui.page}>
        {editing ? (
          <>
            <Field
              label={tab === 'jobs' ? '岗位名称' : '资料名称'}
              value={name}
              onChangeText={setName}
            />
            {tab === 'jobs' ? (
              <Field
                label="公司（选填）"
                value={company}
                onChangeText={setCompany}
              />
            ) : (
              <Select
                label="资料类型"
                value={kind}
                onChange={v => setKind(v as typeof kind)}
                options={[
                  {value: 'resume', label: '简历'},
                  {value: 'experience', label: '个人经历'},
                  {value: 'draft', label: '准备草稿'},
                ]}
              />
            )}
            <Field
              label={tab === 'jobs' ? '岗位描述' : '内容'}
              multiline
              value={text}
              onChangeText={setText}
              style={{minHeight: 260}}
            />
            {tab !== 'jobs' && kind !== 'draft' && (
              <Txt muted small>
                保存前请核实内容均为自己的真实经历；AI
                草稿中的假设和示例需要删除或改写。
              </Txt>
            )}
            <Notice text={notice} />
            <Button
              label="保存"
              busy={busy}
              onPress={() =>
                tab !== 'jobs' && kind !== 'draft'
                  ? Alert.alert(
                      '确认真实经历',
                      '此内容将作为 AI 回答的事实依据。',
                      [
                        {text: '继续检查', style: 'cancel'},
                        {text: '已核实，保存', onPress: save},
                      ],
                    )
                  : save()
              }
            />
            <Button
              tone="quiet"
              label="取消"
              disabled={busy}
              onPress={() => setEditing(null)}
            />
          </>
        ) : (
          <>
            <View style={ui.row}>
              <View style={ui.fill}>
                <Button
                  label={tab === 'jobs' ? '＋ 添加岗位' : '＋ 添加资料'}
                  onPress={() => begin()}
                />
              </View>
              {tab !== 'jobs' && (
                <Button
                  tone="quiet"
                  label="导入简历"
                  busy={busy}
                  onPress={upload}
                />
              )}
            </View>
            <Notice text={notice} />
            {busy && <Txt muted>正在加载…</Txt>}
            {tab === 'jobs'
              ? jobs.map(j => (
                  <View
                    key={j.id}
                    style={[
                      ui.card,
                      {borderColor: t.divider, backgroundColor: t.bgSurface},
                    ]}>
                    <Text style={[ui.h2, {color: t.textPrimary}]}>
                      {j.title}
                    </Text>
                    <Txt muted>{j.company || '未填写公司'}</Txt>
                    <Text
                      numberOfLines={3}
                      style={[ui.body, {color: t.textSecondary}]}>
                      {j.description}
                    </Text>
                    <View style={ui.row}>
                      <Button
                        tone="quiet"
                        label="编辑"
                        onPress={() => begin(j.id)}
                      />
                      <Button
                        tone="quiet"
                        label="删除"
                        onPress={() =>
                          Alert.alert(
                            '删除岗位？',
                            '已有面试的岗位快照会保留。',
                            [
                              {text: '取消', style: 'cancel'},
                              {
                                text: '删除',
                                style: 'destructive',
                                onPress: async () => {
                                  try {
                                    await deleteJob(j.id);
                                    await load();
                                  } catch (e) {
                                    setNotice((e as Error).message);
                                  }
                                },
                              },
                            ],
                          )
                        }
                      />
                    </View>
                  </View>
                ))
              : resumes.map(r => (
                  <View
                    key={r.id}
                    style={[
                      ui.card,
                      {borderColor: t.divider, backgroundColor: t.bgSurface},
                    ]}>
                    <Txt muted small>
                      {r.kind === 'draft'
                        ? '准备草稿 · 不用于个人事实'
                        : r.kind === 'experience'
                        ? '个人经历'
                        : '简历'}{' '}
                      · v{r.version}
                    </Txt>
                    <Text style={[ui.h2, {color: t.textPrimary}]}>
                      {r.filename}
                    </Text>
                    <Text
                      numberOfLines={3}
                      style={[ui.body, {color: t.textSecondary}]}>
                      {r.text}
                    </Text>
                    <Button
                      tone="quiet"
                      label="查看 / 编辑新版本"
                      onPress={() => begin(r.id)}
                    />
                  </View>
                ))}
            {!busy && (tab === 'jobs' ? jobs : resumes).length === 0 && (
              <Empty
                title={
                  tab === 'jobs' ? '为下一场面试做好准备' : '让回答关联你的经历'
                }
                detail={
                  tab === 'jobs'
                    ? '保存岗位要求，开始面试时直接选择。'
                    : '导入 PDF、DOCX、TXT，或粘贴简历与项目经历。'
                }
              />
            )}
            <Button tone="quiet" label="刷新" disabled={busy} onPress={load} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
