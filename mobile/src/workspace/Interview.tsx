import {AudioCapture} from '../native';
import React, {useEffect, useRef, useState} from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
  ANSWER_STYLES,
  getJobs,
  getResumes,
  type Job,
  type ResumeVersion,
  type Settings,
  type WorkspaceSession,
} from '../api/workspace';
import {
  Button,
  Choices,
  Empty,
  Field,
  Notice,
  Select,
  Segments,
  Txt,
  AnswerText,
  ui,
  usePalette,
} from './ui';
import {duration, uuid} from './model';
import type {InterviewController} from './useInterview';

export function InterviewSetup({
  controller,
  settings,
}: {
  controller: InterviewController;
  settings: Settings;
}) {
  const [jobs, setJobs] = useState<Job[]>([]),
    [resumes, setResumes] = useState<ResumeVersion[]>([]);
  const [job, setJob] = useState(''),
    [resume, setResume] = useState(''),
    [role, setRole] = useState(''),
    [company, setCompany] = useState('');
  const [style, setStyle] = useState(settings.answer_style),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = () =>
    Promise.all([getJobs(), getResumes()])
      .then(([j, r]) => {
        setJobs(j);
        setResumes(r);
      })
      .catch(e => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => setStyle(settings.answer_style), [settings.answer_style]);
  const start = async () => {
    const selectedJob = jobs.find(j => j.id === job),
      selectedResume = resumes.find(r => r.id === resume);
    const title = selectedJob?.title || role.trim();
    if (!title) {
      setError('请填写或选择面试岗位');
      return;
    }
    setBusy(true);
    setError('');
    const s: WorkspaceSession = {
      id: uuid(),
      title,
      role: title,
      company: selectedJob?.company || company.trim(),
      job_description: selectedJob?.description || '',
      resume_id: selectedResume?.id || null,
      resume_snapshot: selectedResume
        ? {
            id: selectedResume.id,
            version: selectedResume.version,
            filename: selectedResume.filename,
            text: selectedResume.text,
          }
        : null,
      status: 'active',
      started_at: Date.now(),
      ended_at: null,
      duration_seconds: 0,
      conversation: [],
      answers: [],
      revision: 0,
      capture_source: 'mic',
      preferences: {
        language: settings.language,
        answer_style: style,
        answer_length: 'detailed',
      },
    };
    try {
      await controller.create(s);
      await controller.resume();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const t = usePalette();
  return (
    <KeyboardAvoidingView
      style={ui.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={ui.page}>
        <Text style={[ui.title, {color: t.textPrimary}]}>准备好，再出发</Text>
        <Txt muted>选好岗位与资料，把注意力留给对话。</Txt>
        <View
          style={[
            ui.card,
            {backgroundColor: t.bgSurface, borderColor: t.divider},
          ]}>
          <Txt>麦克风现场辅助</Txt>
          <Txt muted small>
            只采集手机麦克风。适合现场面试，或用另一台设备外放面试声音。同一手机通话时，麦克风可能被通话应用占用。
          </Txt>
        </View>
        <Select
          label="面试岗位"
          value={job}
          options={[
            {value: '', label: '临时填写岗位'},
            ...jobs.map(j => ({
              value: j.id,
              label: j.title,
              description: j.company,
            })),
          ]}
          onChange={setJob}
        />
        {!job && (
          <>
            <Field
              label="岗位名称"
              value={role}
              onChangeText={v => {
                setRole(v);
                setError('');
              }}
              placeholder="例如：全栈开发工程师"
              error={!role && error.includes('岗位') ? error : undefined}
            />
            <Field
              label="公司（选填）"
              value={company}
              onChangeText={setCompany}
            />
          </>
        )}
        <Select
          label="关联简历 / 个人经历"
          value={resume}
          options={[
            {value: '', label: '暂不关联资料'},
            ...resumes.map(r => ({
              value: r.id,
              label: `${r.filename} · v${r.version}`,
            })),
          ]}
          onChange={setResume}
        />
        <Txt muted small>
          仅引用你确认过的真实资料。AI 准备草稿不会作为个人经历。
        </Txt>
        <Txt>回答方式</Txt>
        <Choices value={style} options={ANSWER_STYLES} onChange={setStyle} />
        <Notice
          text={error}
          action={error && !error.includes('岗位') ? '重新加载资料' : undefined}
          onAction={load}
        />
        <Button
          label="开始面试"
          busy={busy || controller.restoring}
          onPress={start}
        />
        <Txt muted small>
          开始时申请麦克风权限。对话逐句记录，由你点击要回答的问题。
        </Txt>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function InterviewLive({
  controller: c,
}: {
  controller: InterviewController;
}) {
  const s = c.session!;
  const t = usePalette();
  const wide = useWindowDimensions().width >= 760;
  const [tab, setTab] = useState('chat'),
    [seen, setSeen] = useState(s.conversation.length),
    [ids, setIds] = useState<string[]>([]),
    [merge, setMerge] = useState(false);
  const [editing, setEditing] = useState<string | null>(null),
    [draft, setDraft] = useState(''),
    [editRole, setEditRole] = useState<'interviewer' | 'user'>('interviewer');
  const list = useRef<FlatList>(null);
  const following = useRef(true);
  const [newBelow, setNewBelow] = useState(false);
  const ended = s.status === 'completed';
  const answer = s.answers.find(a => a.id === c.selected) || s.answers.at(-1);
  useEffect(() => {
    if (tab === 'chat') {
      setSeen(s.conversation.length);
    }
  }, [tab, s.conversation.length]);
  const ask = (questionIds: string[], supplement?: string) => {
    setTab('answer');
    c.answer(questionIds, supplement);
  };
  const edit = (id: string) => {
    const m = s.conversation.find(v => v.id === id);
    setEditing(id);
    setDraft(m?.text || '');
    setEditRole(m?.role === 'user' ? 'user' : 'interviewer');
  };
  const chat = (
    <View style={[ui.fill, {backgroundColor: t.bg}]}>
      <View style={[ui.row, {padding: 12, justifyContent: 'space-between'}]}>
        <Txt muted small>
          {s.conversation.length} 条对话 · 长按修正
        </Txt>
        {!ended && (
          <Button
            tone="quiet"
            label={merge ? '取消合并' : '合并提问'}
            onPress={() => {
              setMerge(!merge);
              setIds([]);
            }}
          />
        )}
      </View>
      <FlatList
        ref={list}
        data={s.conversation}
        keyExtractor={m => m.id}
        contentContainerStyle={{padding: 16, gap: 16, flexGrow: 1}}
        keyboardShouldPersistTaps="handled"
        onScroll={e => {
          const n = e.nativeEvent;
          following.current =
            n.contentSize.height -
              n.layoutMeasurement.height -
              n.contentOffset.y <
            100;
          if (following.current) {
            setNewBelow(false);
          }
        }}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          if (following.current) {
            list.current?.scrollToEnd({animated: false});
          } else {
            setNewBelow(true);
          }
        }}
        ListEmptyComponent={
          <Empty
            title="对话会留在这里"
            detail="手机麦克风听到的内容会逐句显示。点一句看回答，也可以手动输入。"
          />
        }
        renderItem={({item: m}) => (
          <View
            style={{
              alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
              gap: 5,
            }}>
            <Txt muted small>
              {m.role === 'user' ? '我' : '对方'}
              {m.edited ? ' · 已修正' : ' · 麦克风'}
              {m.status === 'streaming'
                ? ' · 正在转写'
                : m.status === 'interrupted'
                ? ' · 待确认'
                : ''}
            </Txt>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${m.text}，点击查看回答，长按修正`}
              onLongPress={() => {
                if (!ended) {
                  edit(m.id);
                }
              }}
              onPress={() => {
                if (merge) {
                  setIds(v =>
                    v.includes(m.id)
                      ? v.filter(id => id !== m.id)
                      : [...v, m.id],
                  );
                } else if (ended) {
                  const a = s.answers.find(v =>
                    v.source_message_ids.includes(m.id),
                  );
                  if (a) {
                    c.setSelected(a.id);
                    setTab('answer');
                  } else {
                    c.setError('本句没有保存的回答，面试已结束');
                  }
                } else {
                  ask([m.id]);
                }
              }}
              style={({pressed}) => ({
                maxWidth: '92%',
                padding: 14,
                borderRadius: 14,
                borderTopLeftRadius: m.role === 'user' ? 14 : 4,
                borderTopRightRadius: m.role === 'user' ? 4 : 14,
                backgroundColor:
                  m.role === 'user' ? t.accentLight : t.bgSurface,
                borderWidth: 1,
                borderColor:
                  ids.includes(m.id) ||
                  answer?.source_message_ids.includes(m.id)
                    ? t.accent
                    : t.divider,
                opacity: pressed ? 0.7 : 1,
              })}>
              <Txt>{m.text}</Txt>
            </Pressable>
          </View>
        )}
      />
      {newBelow && (
        <Button
          tone="quiet"
          label="查看最新对话 ↓"
          onPress={() => {
            following.current = true;
            setNewBelow(false);
            list.current?.scrollToEnd({animated: true});
          }}
        />
      )}
      {!ended && (
        <View style={{padding: 12, gap: 8}}>
          {merge ? (
            <Button
              disabled={!ids.length}
              label={`合并 ${ids.length} 句提问`}
              onPress={() => {
                ask(
                  s.conversation.filter(m => ids.includes(m.id)).map(m => m.id),
                );
                setMerge(false);
                setIds([]);
              }}
            />
          ) : (
            <Button
              tone="quiet"
              label="＋ 手动添加问题"
              onPress={() => {
                setEditing('new');
                setDraft('');
                setEditRole('interviewer');
              }}
            />
          )}
        </View>
      )}
    </View>
  );
  const answers = (
    <View style={[ui.fill, {backgroundColor: t.bgSurface}]}>
      <ScrollView contentContainerStyle={ui.page}>
        {s.answers.length > 1 && (
          <Select
            label="已保存的回答"
            value={answer?.id || ''}
            options={s.answers.map((a, i) => ({
              value: a.id,
              label: `${i + 1}. ${a.question_text.slice(0, 40)}`,
            }))}
            onChange={c.setSelected}
          />
        )}
        {answer ? (
          <>
            <Txt muted small>
              回答参考 ·{' '}
              {ANSWER_STYLES.find(
                v => v.value === answer.context_snapshot?.answer_style,
              )?.label || '回答'}
            </Txt>
            <Text style={[ui.h2, {color: t.textPrimary}]}>
              {answer.question_text}
            </Text>
            {!answer.text &&
            ['loading', 'streaming'].includes(answer.status) ? (
              <Button label="正在组织回答…" busy onPress={() => {}} />
            ) : (
              <AnswerText text={answer.text} />
            )}
            {['cancelled', 'truncated', 'error'].includes(answer.status) && (
              <Notice
                text={
                  answer.status === 'cancelled'
                    ? '已停止，保留部分内容'
                    : answer.status === 'truncated'
                    ? '本次输出达到长度上限，可继续补充'
                    : '生成未完成，可重试'
                }
              />
            )}
            {!!answer.text && (
              <Button
                tone="quiet"
                label="复制回答"
                onPress={() =>
                  AudioCapture.copyText(answer.text)
                    .then(() => c.setError('回答已复制'))
                    .catch(() => c.setError('复制失败，可长按文字复制'))
                }
              />
            )}
            {!ended &&
              (['loading', 'streaming'].includes(answer.status) ? (
                <Button tone="quiet" label="停止生成" onPress={c.cancel} />
              ) : (
                <>
                  <Button
                    tone="quiet"
                    label="补充一个例子"
                    onPress={() =>
                      ask(
                        answer.source_message_ids,
                        '补充一个具体例子，基于已知事实，不虚构经历',
                      )
                    }
                  />
                  <Button
                    tone="quiet"
                    label="深入解释与取舍"
                    onPress={() =>
                      ask(
                        answer.source_message_ids,
                        '进一步解释原理、边界条件与方案取舍',
                      )
                    }
                  />
                  {answer.status !== 'done' && (
                    <Button
                      label="重新生成"
                      onPress={() => ask(answer.source_message_ids)}
                    />
                  )}
                </>
              ))}
          </>
        ) : (
          <Empty
            title="选一句，展开思路"
            detail="在对话中点击想回答的问题。查看回答时，对话仍会继续记录。"
          />
        )}
      </ScrollView>
    </View>
  );
  return (
    <View style={ui.fill}>
      <View
        style={[
          ui.header,
          {gap: 10, borderColor: t.divider, backgroundColor: t.bgSurface},
        ]}>
        <View style={ui.row}>
          <View style={ui.fill}>
            <Text numberOfLines={1} style={[ui.h2, {color: t.textPrimary}]}>
              {s.role}
            </Text>
            <Txt muted small>
              {ended
                ? '已结束 · 仅查看'
                : c.capture === 'capturing'
                ? '麦克风采集中'
                : '已暂停采集'}{' '}
              · {duration(s.duration_seconds)}
            </Txt>
          </View>
          {ended ? (
            <Button tone="quiet" label="返回" onPress={c.close} />
          ) : (
            <>
              <Button
                tone="quiet"
                busy={c.busy}
                label={c.capture === 'capturing' ? '暂停' : '继续'}
                onPress={() =>
                  c.capture === 'capturing' ? c.stop(false) : c.resume()
                }
              />
              <Button
                tone="quiet"
                label="结束"
                disabled={c.busy}
                onPress={() =>
                  Alert.alert(
                    '结束本场面试？',
                    '结束后保留对话和答案，可以复盘，但不能再生成答案。',
                    [
                      {text: '取消', style: 'cancel'},
                      {
                        text: '结束面试',
                        style: 'destructive',
                        onPress: () => c.stop(true),
                      },
                    ],
                  )
                }
              />
            </>
          )}
        </View>
        {!ended && (
          <View style={ui.row}>
            <View
              style={{
                width: 5 + Math.min(c.level, 1) * 32,
                height: 4,
                borderRadius: 2,
                backgroundColor: t.accent,
              }}
            />
            <Txt muted small>
              正在记录：
            </Txt>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                c.setSpeaker(
                  c.speaker === 'interviewer' ? 'user' : 'interviewer',
                )
              }
              style={{minHeight: 44, justifyContent: 'center'}}>
              <Text style={{color: t.accent}}>
                {c.speaker === 'interviewer' ? '对方' : '我'} · 点击切换
              </Text>
            </Pressable>
          </View>
        )}
        <Notice
          text={c.error}
          action={c.error.includes('权限') ? '打开权限设置' : '收起提示'}
          onAction={() =>
            c.error.includes('权限') ? Linking.openSettings() : c.setError('')
          }
        />
        {!wide && (
          <Segments
            value={tab}
            onChange={setTab}
            options={[
              {
                value: 'chat',
                label: `对话${
                  s.conversation.length > seen
                    ? ` +${s.conversation.length - seen}`
                    : ''
                }`,
              },
              {value: 'answer', label: '回答参考'},
            ]}
          />
        )}
      </View>
      <View style={[ui.fill, wide && {flexDirection: 'row'}]}>
        <View
          style={
            wide ? {flex: 0.4} : tab === 'chat' ? ui.fill : {display: 'none'}
          }>
          {chat}
        </View>
        <View
          style={
            wide ? {flex: 0.6} : tab === 'answer' ? ui.fill : {display: 'none'}
          }>
          {answers}
        </View>
      </View>
      {c.sync.includes('本机') && (
        <Button
          tone="quiet"
          label="导出本机备份"
          onPress={() => c.exportLocal().catch(e => c.setError(e.message))}
        />
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => c.flush().catch(e => c.setError(e.message))}
        style={{
          paddingHorizontal: 16,
          minHeight: 34,
          justifyContent: 'center',
          borderTopWidth: 1,
          borderColor: t.divider,
          backgroundColor: t.bgSurface,
        }}>
        <Txt muted small>
          {c.sync}
          {c.sync.includes('待同步') ? ' · 点击重试' : ''}
        </Txt>
      </Pressable>
      <Modal
        visible={editing !== null}
        animationType="slide"
        onRequestClose={() => setEditing(null)}>
        <SafeAreaView style={[ui.fill, {backgroundColor: t.bg}]}>
          <KeyboardAvoidingView
            style={ui.fill}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={ui.page}>
              <Text style={[ui.h2, {color: t.textPrimary}]}>
                {editing === 'new' ? '添加问题' : '修正这句话'}
              </Text>
              <Field
                label="内容"
                multiline
                autoFocus
                value={draft}
                onChangeText={setDraft}
              />
              <Segments
                value={editRole}
                onChange={v => setEditRole(v as 'interviewer' | 'user')}
                options={[
                  {value: 'interviewer', label: '对方'},
                  {value: 'user', label: '我'},
                ]}
              />
              <Button
                label="保存"
                disabled={!draft.trim()}
                onPress={() => {
                  if (editing === 'new') {
                    c.add(draft);
                  } else if (editing) {
                    c.edit(editing, draft, editRole);
                  }
                  setEditing(null);
                }}
              />
              <Button
                tone="quiet"
                label="取消"
                onPress={() => setEditing(null)}
              />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
