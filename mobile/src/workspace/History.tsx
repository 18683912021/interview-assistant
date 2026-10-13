import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Alert, FlatList, ScrollView, Share, Text, View} from 'react-native';
import {
  clearInterviewAudio,
  deleteWorkspaceInterview,
  generateReview,
  getInterviewPage,
  getWorkspaceInterview,
  type SessionSummary,
  type WorkspaceSession,
} from '../api/workspace';
import {
  AnswerText,
  Button,
  Empty,
  Field,
  Notice,
  Segments,
  Txt,
  ui,
  usePalette,
} from './ui';
import {duration} from './model';
export default function History({
  onResume,
}: {
  onResume: (session: WorkspaceSession) => void;
}) {
  const t = usePalette();
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all'),
    [items, setItems] = useState<SessionSummary[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<WorkspaceSession | null>(null),
    [section, setSection] = useState('answers'),
    [review, setReview] = useState(''),
    [reviewing, setReviewing] = useState(false);
  const generation = useRef(0),
    loading = useRef(false),
    abort = useRef<AbortController | null>(null);
  const load = useCallback(
    async (p = 1) => {
      const id = ++generation.current;
      loading.current = true;
      setBusy(true);
      setNotice('');
      try {
        const data = await getInterviewPage(p, query, filter);
        if (id !== generation.current) {
          return;
        }
        setItems(old => (p === 1 ? data.items : [...old, ...data.items]));
        setTotal(data.total);
        setPage(p);
      } catch (e) {
        if (id === generation.current) {
          setNotice((e as Error).message);
        }
      } finally {
        if (id === generation.current) {
          loading.current = false;
          setBusy(false);
        }
      }
    },
    [query, filter],
  );
  useEffect(() => {
    const requestGeneration = generation;
    const timer = setTimeout(() => load(), 300);
    return () => {
      clearTimeout(timer);
      requestGeneration.current++;
    };
  }, [load]);
  useEffect(() => () => abort.current?.abort(), []);
  const open = async (id: string) => {
    setBusy(true);
    try {
      const s = await getWorkspaceInterview(id);
      setDetail(s);
      setReview(s.review?.text || '');
      setSection('answers');
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const back = () => {
    abort.current?.abort();
    setDetail(null);
    setReview('');
    setNotice('');
    load();
  };
  if (detail) {
    return (
      <View style={ui.fill}>
        <View style={[ui.header, {borderColor: t.divider, gap: 10}]}>
          <View style={ui.row}>
            <Button tone="quiet" label="返回" onPress={back} />
            <View style={ui.fill}>
              <Text numberOfLines={1} style={[ui.h2, {color: t.textPrimary}]}>
                {detail.title}
              </Text>
              <Txt muted small>
                {detail.status === 'completed' ? '已结束' : '未结束'} ·{' '}
                {duration(detail.duration_seconds)}
              </Txt>
            </View>
          </View>
          <Segments
            value={section}
            onChange={setSection}
            options={[
              {value: 'answers', label: '回答'},
              {value: 'chat', label: '对话'},
              {value: 'review', label: '复盘'},
              {value: 'info', label: '资料'},
            ]}
          />
        </View>
        <ScrollView contentContainerStyle={ui.page}>
          <Notice text={notice} />
          {detail.status !== 'completed' && (
            <Button label="继续本场面试" onPress={() => onResume(detail)} />
          )}
          {section === 'answers' &&
            (detail.answers.length ? (
              detail.answers.map(a => (
                <View
                  key={a.id}
                  style={[
                    ui.card,
                    {borderColor: t.divider, backgroundColor: t.bgSurface},
                  ]}>
                  <Text style={[ui.h2, {color: t.textPrimary}]}>
                    {a.question_text}
                  </Text>
                  <AnswerText text={a.text || '没有保存的回答内容'} />
                  {a.status !== 'done' && (
                    <Txt muted small>
                      此回答未完整生成
                    </Txt>
                  )}
                </View>
              ))
            ) : (
              <Empty
                title="没有保存的回答"
                detail="本场记录可查看对话。结束后不再生成答案。"
              />
            ))}
          {section === 'chat' &&
            detail.conversation.map(m => (
              <View
                key={m.id}
                style={[
                  ui.card,
                  {borderColor: t.divider, backgroundColor: t.bgSurface},
                ]}>
                <Txt muted small>
                  {m.role === 'user'
                    ? '我'
                    : m.role === 'ai'
                    ? 'AI参考'
                    : '对方'}
                  {m.status === 'interrupted' ? ' · 待确认' : ''}
                </Txt>
                <Txt>{m.text}</Txt>
              </View>
            ))}
          {section === 'review' && (
            <>
              <Txt muted small>
                复盘基于保存的记录。麦克风说话人未经修正时，请先核对归属，不把参考答案当成自己的表现。
              </Txt>
              {!!review && <AnswerText text={review} />}
              <Button
                disabled={detail.status !== 'completed'}
                label={
                  reviewing ? '停止生成' : review ? '重新查看复盘' : '生成复盘'
                }
                onPress={async () => {
                  if (reviewing) {
                    abort.current?.abort();
                    return;
                  }
                  const controller = new AbortController();
                  abort.current = controller;
                  setReviewing(true);
                  setNotice('');
                  try {
                    await generateReview(
                      detail.id,
                      setReview,
                      controller.signal,
                    );
                    const updated = await getWorkspaceInterview(detail.id);
                    if (controller.signal.aborted) {
                      return;
                    }
                    setDetail(updated);
                    setReview(updated.review?.text || '');
                  } catch (e) {
                    setNotice(
                      controller.signal.aborted
                        ? '已停止；部分内容未保存为正式复盘'
                        : (e as Error).message,
                    );
                  } finally {
                    setReviewing(false);
                  }
                }}
              />
            </>
          )}
          {section === 'info' && (
            <>
              <Txt>岗位：{detail.role}</Txt>
              <Txt muted>{detail.company || '未填写公司'}</Txt>
              <Txt>{detail.job_description || '未关联岗位描述'}</Txt>
              <Txt>
                简历版本：{detail.resume_snapshot?.filename || '未关联'}
              </Txt>
              {detail.resume_snapshot && (
                <Txt>{detail.resume_snapshot.text}</Txt>
              )}
              <Button
                tone="quiet"
                label="导出文字记录"
                onPress={() =>
                  Share.share({
                    message: [
                      detail.title,
                      ...detail.conversation.map(
                        m => `${m.role === 'user' ? '我' : '对方'}：${m.text}`,
                      ),
                      ...detail.answers.map(
                        a => `问题：${a.question_text}\n参考答案：${a.text}`,
                      ),
                    ].join('\n\n'),
                  }).catch(e => setNotice(e.message))
                }
              />
              {detail.status === 'completed' && (
                <Button
                  tone="quiet"
                  label="清理本场云端录音"
                  onPress={() =>
                    Alert.alert(
                      '清理录音？',
                      '保留对话、答案和复盘，录音删除后无法恢复。',
                      [
                        {text: '取消', style: 'cancel'},
                        {
                          text: '清理',
                          style: 'destructive',
                          onPress: async () => {
                            try {
                              await clearInterviewAudio(detail.id);
                              setNotice('录音已清理，文字记录已保留');
                            } catch (e) {
                              setNotice((e as Error).message);
                            }
                          },
                        },
                      ],
                    )
                  }
                />
              )}
              <Button
                tone="danger"
                label="删除本场记录"
                onPress={() =>
                  Alert.alert(
                    '删除本场记录？',
                    '对话、答案和录音将一并删除。',
                    [
                      {text: '取消', style: 'cancel'},
                      {
                        text: '删除',
                        style: 'destructive',
                        onPress: async () => {
                          try {
                            await deleteWorkspaceInterview(detail.id);
                            back();
                          } catch (e) {
                            setNotice((e as Error).message);
                          }
                        },
                      },
                    ],
                  )
                }
              />
            </>
          )}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={ui.fill}>
      <View style={[ui.header, {gap: 12, borderColor: t.divider}]}>
        <Text style={[ui.title, {color: t.textPrimary}]}>面试记录</Text>
        <Field
          label={`共 ${total} 场`}
          placeholder="搜索岗位、公司或面试名称"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
        <Segments
          value={filter}
          onChange={setFilter}
          options={[
            {value: 'all', label: '全部'},
            {value: 'completed', label: '已结束'},
            {value: 'active', label: '未结束'},
          ]}
        />
        <Notice text={notice} />
      </View>
      <FlatList
        data={items}
        keyExtractor={s => s.id}
        contentContainerStyle={{padding: 20, gap: 12, flexGrow: 1}}
        refreshing={busy}
        onRefresh={() => load()}
        onEndReached={() => {
          if (!loading.current && items.length < total) {
            load(page + 1);
          }
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          !busy ? (
            <Empty
              title="每一场，都有积累"
              detail="面试结束后，在这里查看对话、答案与复盘。"
            />
          ) : null
        }
        renderItem={({item: s}) => (
          <View
            style={[
              ui.card,
              {backgroundColor: t.bgSurface, borderColor: t.divider},
            ]}>
            <View style={ui.row}>
              <View style={ui.fill}>
                <Text style={[ui.h2, {color: t.textPrimary}]}>{s.title}</Text>
                <Txt muted small>
                  {s.company || s.role} ·{' '}
                  {new Date(s.started_at).toLocaleDateString()}
                </Txt>
              </View>
              <Txt muted small>
                {s.status === 'completed' ? '已结束' : '未结束'}
              </Txt>
            </View>
            <Txt muted small>
              {s.message_count} 条对话 · {s.answer_count} 份回答 ·{' '}
              {duration(s.duration_seconds)}
            </Txt>
            <Button
              tone="quiet"
              label="查看详情"
              disabled={busy}
              onPress={() => open(s.id)}
            />
          </View>
        )}
        ListFooterComponent={
          items.length < total ? (
            <Button
              tone="quiet"
              label="加载更多"
              busy={busy}
              onPress={() => load(page + 1)}
            />
          ) : items.length > 0 ? (
            <Txt muted small>
              已显示全部记录
            </Txt>
          ) : null
        }
      />
    </View>
  );
}
